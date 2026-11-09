import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import xtermHeadless from "@xterm/headless";
import serializePackage from "@xterm/addon-serialize";
import { LogStore } from "./logStore.js";
import { PtyTerminalFactory, type TerminalFactory, type TerminalSession, type TerminalOptions } from "./terminal.js";
import type { AppSettings, ConsoleCreateRequest } from "./types.js";
import { maxRuntimeBacklog, maxRuntimeFrame, runtimeAddress, runtimeTokenPath, runtimeVersion, validConsoleId, type RuntimeRun, type RuntimeRequest, type RuntimeEvent, type TerminalScreen } from "./runtimeProtocol.js";

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializePackage;
interface OwnedRun { state: RuntimeRun; session: TerminalSession; mirror: InstanceType<typeof Terminal>; serializer: InstanceType<typeof SerializeAddon>; retired?: boolean; exited: Promise<void>; resolveExit(): void }

export class TerminalHost {
  readonly address: string;
  private readonly token: string;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly authorized = new Set<net.Socket>();
  private readonly runs = new Map<string, OwnedRun>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly requests = new Map<string, { signature: string; expiresAt: number; result: Promise<unknown> }>();
  private readonly logs: LogStore;
  private readonly cleanup: ReturnType<typeof setInterval>;
  private closing = false;

  constructor(private readonly settings: AppSettings, private readonly factory: TerminalFactory = new PtyTerminalFactory()) {
    this.address = runtimeAddress(settings.dataDir);
    fs.mkdirSync(settings.dataDir, { recursive: true });
    const tokenFile = runtimeTokenPath(settings.dataDir);
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, JSON.stringify({ token: crypto.randomBytes(32).toString("hex") }), { mode: 0o600, flag: "wx", flush: true });
    this.token = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token;
    if (typeof this.token !== "string" || !/^[a-f0-9]{64}$/.test(this.token)) throw new Error("Invalid terminal host credential");
    this.logs = new LogStore(settings);
    this.server = net.createServer(socket => this.accept(socket));
    this.cleanup = setInterval(() => this.sweep(), Math.max(1000, settings.temporaryConsoles.cleanupIntervalMs));
    this.cleanup.unref();
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.address, () => { this.server.off("error", reject); resolve(); }); });
  }

  private write(socket: net.Socket, value: unknown): void {
    if (socket.destroyed) return;
    const text = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(text) > maxRuntimeFrame || socket.writableLength + Buffer.byteLength(text) > maxRuntimeBacklog) { socket.destroy(); return; }
    socket.write(text);
  }
  private broadcast(event: RuntimeEvent): void { for (const socket of this.authorized) this.write(socket, event); }

  private accept(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    const authTimer = setTimeout(() => socket.destroy(), 3000);
    socket.on("error", () => undefined);
    socket.on("close", () => { clearTimeout(authTimer); this.sockets.delete(socket); this.authorized.delete(socket); });
    socket.on("data", chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > maxRuntimeFrame) { socket.destroy(); return; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let request: RuntimeRequest;
        try { request = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!request || typeof request.id !== "string" || request.id.length > 100 || typeof request.method !== "string") { socket.destroy(); return; }
        if (!this.authorized.has(socket)) {
          const supplied = request.args?.token;
          const valid = request.method === "hello" && request.args?.version === runtimeVersion && typeof supplied === "string" && supplied.length === this.token.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token));
          if (!valid) { this.write(socket, { id: request.id, error: "Terminal host authentication/protocol mismatch" }); socket.end(); return; }
          clearTimeout(authTimer); this.authorized.add(socket);
          this.write(socket, { id: request.id, result: { version: runtimeVersion } });
          continue;
        }
        void this.execute(request).then(result => this.write(socket, { id: request.id, result }), error => this.write(socket, { id: request.id, error: String(error instanceof Error ? error.message : error) }));
      }
    });
  }

  private execute(request: RuntimeRequest): Promise<unknown> {
    if (!Number.isFinite(request.expiresAt) || request.expiresAt < Date.now() || request.expiresAt > Date.now() + 65_000) return Promise.reject(new Error("Expired terminal request; delivery may already have occurred, do not replay input"));
    const signature = JSON.stringify([request.method, request.args]);
    if (["list", "snapshot", "touch"].includes(request.method)) return Promise.resolve().then(() => this.dispatch(request.method, request.args));
    const previous = this.requests.get(request.id);
    if (previous) return previous.signature === signature ? previous.result : Promise.reject(new Error("Request identity conflict"));
    for (const [id, entry] of this.requests) if (entry.expiresAt < Date.now()) this.requests.delete(id);
    if (this.requests.size >= 16384) return Promise.reject(new Error("Terminal request capacity exceeded"));
    const key = request.args?.consoleId;
    const before = this.queues.get(key) ?? Promise.resolve();
    const result = before.catch(() => undefined).then(() => this.dispatch(request.method, request.args));
    if (key) {
      this.queues.set(key, result);
      void result.finally(() => { if (this.queues.get(key) === result) this.queues.delete(key); }).catch(() => undefined);
    }
    this.requests.set(request.id, { signature, expiresAt: request.expiresAt, result });
    return result;
  }

  private async dispatch(method: string, args: any): Promise<unknown> {
    if (this.closing) throw new Error("Terminal host stopping");
    if (method === "list") {
      const offset = Number.isInteger(args?.offset) && args.offset >= 0 ? args.offset : 0;
      return [...this.runs.values()].filter(run => !run.retired).slice(offset, offset + 16).map(run => run.state);
    }
    if (!validConsoleId(args?.consoleId)) throw new Error("Invalid console ID");
    if (method === "start") return this.start(args);
    const run = this.runs.get(args.consoleId);
    if (!run || run.state.runId !== args.runId || run.retired) throw new Error("Terminal run not found or superseded");
    if (method === "snapshot") return this.snapshot(run);
    if (method === "touch") { run.state.lastAccessedAt = new Date().toISOString(); return true; }
    if (method === "close") {
      await this.stopRun(run);
      run.retired = true;
      return true;
    }
    if (run.state.status === "exited") throw new Error("Terminal run exited");
    if (method === "input") {
      if (typeof args.data !== "string" || Buffer.byteLength(args.data) > 1024 * 1024) throw new Error("Invalid terminal input");
      await run.session.write(args.data);
      run.state.lastInputAt = new Date().toISOString();
      return { at: run.state.lastInputAt };
    }
    if (method === "resize") {
      if (!Number.isInteger(args.cols) || !Number.isInteger(args.rows) || args.cols < 20 || args.cols > 400 || args.rows < 5 || args.rows > 200) throw new Error("Invalid terminal dimensions");
      run.session.resize(args.cols, args.rows);
      if (!run.state.nativeCli?.visible) run.mirror.resize(args.cols, args.rows);
      return true;
    }
    if (method === "native") {
      if (args.visible !== undefined && typeof args.visible !== "boolean") throw new Error("visible must be boolean");
      if (!run.session.nativeWindow) throw new Error("Native CLI requires yopenconsole");
      const state = await run.session.nativeWindow(args.visible);
      run.state.nativeCli = state;
      run.mirror.resize(state.cols, state.rows);
      this.broadcast({ event: "state", run: run.state });
      return state;
    }
    throw new Error(`Unknown terminal method ${method}`);
  }

  private start(args: { consoleId: string; runId: string; shell: string; args: string[]; options: TerminalOptions }): RuntimeRun {
    const existing = this.runs.get(args.consoleId);
    if (existing?.state.runId === args.runId && !existing.retired) return existing.state;
    if (existing && existing.state.status !== "exited") throw new Error("Console already running; close its exact run before starting again");
    if (!/^[a-f0-9-]{36}$/.test(args.runId) || typeof args.shell !== "string" || !Array.isArray(args.args) || args.args.some(arg => typeof arg !== "string")) throw new Error("Invalid launch request");
    const options = args.options;
    if (!options || typeof options.cwd !== "string" || !Number.isInteger(options.cols) || !Number.isInteger(options.rows) || options.cols < 20 || options.cols > 400 || options.rows < 5 || options.rows > 200) throw new Error("Invalid launch options");
    if ([...this.runs.values()].filter(run => run.state.status !== "exited").length >= 1024) throw new Error("Terminal capacity exceeded");
    existing?.mirror.dispose();
    const mirror = new Terminal({ cols: options.cols, rows: options.rows, scrollback: 0, convertEol: true, allowProposedApi: true });
    const serializer = new SerializeAddon();
    mirror.loadAddon(serializer);
    const session = this.factory.spawn(args.shell, args.args, { ...options, dataDir: this.settings.dataDir });
    let resolveExit!: () => void;
    const run: OwnedRun = { session, mirror, serializer, exited: new Promise(resolve => { resolveExit = resolve; }), resolveExit: () => resolveExit(), state: {
      consoleId: args.consoleId, runId: args.runId, definition: options.definition ?? { id: args.consoleId },
      launch: JSON.stringify([options.definition?.command ?? "", options.cwd, args.shell, args.args]),
      pid: session.pid, status: session.onReady ? "starting" : "running", startedAt: new Date().toISOString(), sequence: 0
    } };
    this.runs.set(args.consoleId, run);
    const output = (data: string) => {
      run.state.lastOutputAt = new Date().toISOString();
      this.logs.append(args.consoleId, data);
      mirror.write(data, () => {
        const sequence = ++run.state.sequence;
        this.broadcast({ event: "output", consoleId: args.consoleId, runId: args.runId, sequence, data, at: run.state.lastOutputAt! });
      });
    };
    output("\x1b[?1049l\x1bc");
    session.onData(output);
    session.onReady?.(pid => { run.state.pid = pid; run.state.status = "running"; this.broadcast({ event: "state", run: run.state }); });
    session.onNativeWindow?.(state => { run.state.nativeCli = state; mirror.resize(state.cols, state.rows); this.broadcast({ event: "state", run: run.state }); });
    session.onExit(code => {
      run.state.status = "exited"; run.state.pid = undefined; run.state.exitCode = code; run.state.nativeCli = undefined;
      output(`\r\n[yconhost] process exited with code ${code ?? "unknown"}\r\n`);
      this.logs.flush(args.consoleId);
      run.resolveExit();
      this.broadcast({ event: "state", run: run.state });
    });
    this.broadcast({ event: "state", run: run.state });
    return run.state;
  }

  private snapshot(run: OwnedRun): Promise<TerminalScreen> {
    return new Promise(resolve => run.mirror.write("", () => resolve({ output: run.serializer.serialize({ scrollback: 0 }), cols: run.mirror.cols, rows: run.mirror.rows, runId: run.state.runId, sequence: run.state.sequence })));
  }

  private async stopRun(run: OwnedRun): Promise<void> {
    if (run.state.status === "exited") return;
    run.session.kill();
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([run.exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Terminal teardown timed out")), 12_000); })]).finally(() => clearTimeout(timer!));
  }

  private sweep(): void {
    const ttl = this.settings.temporaryConsoles.ttlHours * 3600_000;
    for (const run of this.runs.values()) {
      const last = Math.max(...[run.state.startedAt, run.state.lastAccessedAt, run.state.lastInputAt, run.state.lastOutputAt].map(value => Date.parse(value ?? "") || 0));
      if (!run.retired && run.state.definition.persistent === false && ttl > 0 && Date.now() - last > ttl) void this.stopRun(run).then(() => { run.retired = true; }).catch(error => console.error(error));
    }
    const inactive = [...this.runs.entries()].filter(([, run]) => run.retired || run.state.status === "exited");
    for (const [id, run] of inactive.slice(0, Math.max(0, this.runs.size - 1024))) { run.mirror.dispose(); this.runs.delete(id); }
  }

  async close(): Promise<void> {
    this.closing = true; clearInterval(this.cleanup);
    for (const socket of this.sockets) socket.destroy();
    await Promise.allSettled([...this.runs.values()].map(run => this.stopRun(run)));
    for (const [id, run] of this.runs) { this.logs.flush(id); run.mirror.dispose(); }
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
}
