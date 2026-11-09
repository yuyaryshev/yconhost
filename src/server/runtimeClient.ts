import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
import type { TerminalFactory, TerminalOptions, TerminalSession } from "./terminal.js";
import type { AppSettings, NativeWindowState } from "./types.js";
import { maxRuntimeFrame, maxRuntimeBacklog, runtimeAddress, runtimeTokenPath, runtimeVersion, type RuntimeEvent, type RuntimeRun, type TerminalScreen } from "./runtimeProtocol.js";

export class RuntimeClient implements TerminalFactory {
  readonly ownsLogs = true;
  connected = false;
  private socket?: net.Socket;
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly sessions = new Map<string, RemoteSession>();
  private stopped = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connecting?: Promise<void>;
  private readonly touches = new Map<string, number>();
  private readonly closing = new Map<string, Promise<unknown>>();

  constructor(private readonly dataDir: string) {}
  async initialize(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!this.connected) {
      try { await this.connect(); } catch (error) {
        if (Date.now() > deadline || this.stopped) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  private connect(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Runtime client stopped"));
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      let token: string;
      try { token = JSON.parse(fs.readFileSync(runtimeTokenPath(this.dataDir), "utf8")).token; } catch (error) { reject(error); return; }
      const socket = net.createConnection(runtimeAddress(this.dataDir));
      this.socket = socket;
      socket.setEncoding("utf8");
      let buffer = "";
      const timer = setTimeout(() => { reject(new Error("Terminal host handshake timed out")); socket.destroy(); }, 3000);
      socket.on("error", reject);
      socket.on("data", chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > maxRuntimeFrame) { socket.destroy(); return; }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          let value: any;
          try { value = JSON.parse(line); } catch { socket.destroy(); return; }
          if (value.event) this.event(value);
          else {
            const request = this.pending.get(value.id);
            if (request) { clearTimeout(request.timer); this.pending.delete(value.id); value.error ? request.reject(new Error(value.error)) : request.resolve(value.result); }
          }
        }
      });
      socket.once("connect", () => {
        void this.request("hello", { token, version: runtimeVersion }, true).then(() => {
          clearTimeout(timer); this.connected = true; this.events.emit("connection", true); resolve();
        }, error => { clearTimeout(timer); reject(error); socket.destroy(); });
      });
      socket.once("close", () => {
        clearTimeout(timer);
        if (this.socket !== socket) return;
        this.connected = false;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Terminal host disconnected; delivery is unknown; input was not retried")); }
        this.pending.clear();
        this.events.emit("connection", false);
        reject(new Error("Terminal host disconnected"));
        this.retryConnection();
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  request<T = any>(method: string, args?: unknown, handshake = false): Promise<T> {
    if ((!this.connected && !handshake) || !this.socket || this.socket.destroyed) return Promise.reject(new Error("Terminal host unavailable; command was not sent"));
    const id = crypto.randomUUID();
    const frame = `${JSON.stringify({ id, method, args, expiresAt: Date.now() + 60_000 })}\n`;
    if (Buffer.byteLength(frame) > maxRuntimeFrame || this.socket.writableLength + Buffer.byteLength(frame) > maxRuntimeBacklog) return Promise.reject(new Error("Terminal request backlog exceeded; command was not sent"));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Terminal host request timed out; delivery is unknown; input was not retried")); }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(frame, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }

  private event(event: RuntimeEvent): void {
    if (event.event === "output") {
      const session = this.sessions.get(event.consoleId);
      if (session?.state.runId !== event.runId || event.sequence <= session.state.sequence) return;
      session.state.sequence = event.sequence; session.state.lastOutputAt = event.at;
      session.events.emit("data", event.data);
    } else {
      const session = this.sessions.get(event.run.consoleId);
      if (session?.state.runId !== event.run.runId) return;
      const before = session.state;
      session.state = event.run;
      session.events.emit("state", event.run);
      if (event.run.pid && event.run.status === "running" && before.status !== "running") session.events.emit("ready", event.run.pid);
      if (event.run.nativeCli) session.events.emit("native", event.run.nativeCli);
      if (event.run.status === "exited" && before.status !== "exited") session.events.emit("exit", event.run.exitCode);
    }
  }

  private retryConnection(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { void this.connect().catch(() => this.retryConnection()); }, 300);
  }
  async listRuns(): Promise<RuntimeRun[]> {
    const runs: RuntimeRun[] = [];
    while (true) {
      const page = await this.request<RuntimeRun[]>("list", { offset: runs.length });
      runs.push(...page);
      if (page.length < 16) return runs;
    }
  }
  onConnection(listener: (connected: boolean) => void): void { this.events.on("connection", listener); }
  async configure(settings: AppSettings): Promise<void> { await this.request("configure", { log: settings.log, temporaryConsoles: settings.temporaryConsoles }); }
  attach(run: RuntimeRun): TerminalSession {
    // A listed run is authoritative even if its earlier start acknowledgement was lost.
    const session = new RemoteSession(this, run);
    this.sessions.set(run.consoleId, session);
    return session;
  }
  spawn(shell: string, args: string[], options: TerminalOptions): TerminalSession {
    if (!this.connected) throw new Error("Terminal host unavailable; console was not started");
    if (!options.consoleId) throw new Error("Durable console ID is required");
    const session = this.attach({ consoleId: options.consoleId, runId: crypto.randomUUID(), definition: options.definition ?? {}, launch: "", status: "starting", startedAt: new Date().toISOString(), sequence: 0 }) as RemoteSession;
    session.ready = Promise.resolve(this.closing.get(options.consoleId)).then(() => this.request<RuntimeRun>("start", { consoleId: options.consoleId, runId: session.state.runId, shell, args, options })).then(state => {
      if (session.state.status !== "exited") {
        session.state = { ...state, sequence: Math.max(state.sequence, session.state.sequence) };
        session.events.emit("state", session.state);
        if (state.pid) session.events.emit("ready", state.pid);
      }
    }).catch(error => { session.events.emit("data", `\r\n[yconhost] terminal start failed: ${error.message}\r\n`); session.events.emit("exit", 1); throw error; });
    void session.ready.catch(() => undefined);
    return session;
  }
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (!this.connected || !session || Date.now() - (this.touches.get(id) ?? 0) < 500) return;
    this.touches.set(id, Date.now());
    void session.call("touch").catch(() => undefined);
  }
  closeSession(session: RemoteSession): void {
    const promise = session.call("close");
    this.closing.set(session.state.consoleId, promise);
    void promise.catch(error => session.events.emit("data", `\r\n[yconhost] terminal close failed: ${error.message}\r\n`));
    void promise.finally(() => {
      if (this.closing.get(session.state.consoleId) === promise) this.closing.delete(session.state.consoleId);
      if (this.sessions.get(session.state.consoleId) === session) this.sessions.delete(session.state.consoleId);
    }).catch(() => undefined);
  }
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
  }
}

class RemoteSession implements TerminalSession {
  readonly events = new EventEmitter();
  ready: Promise<void> = Promise.resolve();
  constructor(private readonly client: RuntimeClient, public state: RuntimeRun) {}
  get pid() { return this.state.pid; }
  get lastInputAt() { return this.state.lastInputAt; }
  get position() { return { runId: this.state.runId, sequence: this.state.sequence }; }
  async call<T = any>(method: string, args: object = {}): Promise<T> { await this.ready; return this.client.request(method, { ...args, consoleId: this.state.consoleId, runId: this.state.runId }); }
  async write(data: string): Promise<void> { const reply = await this.call<{ at: string }>("input", { data }); this.state.lastInputAt = reply.at; }
  resize(cols: number, rows: number): void { void this.call("resize", { cols, rows }).catch(error => this.events.emit("state", { ...this.state, runtimeError: error.message })); }
  kill(): void { this.client.closeSession(this); }
  onData(listener: (chunk: string) => void): void { this.events.on("data", listener); }
  onExit(listener: (code?: number) => void): void { this.events.on("exit", listener); }
  onReady(listener: (pid: number) => void): void { this.events.on("ready", listener); }
  onNativeWindow(listener: (state: NativeWindowState) => void): void { this.events.on("native", listener); }
  onState(listener: (state: RuntimeRun) => void): void { this.events.on("state", listener); }
  nativeWindow(visible?: boolean): Promise<NativeWindowState> { return this.call("native", { visible }); }
  snapshot(): Promise<TerminalScreen> { return this.call("snapshot"); }
}
