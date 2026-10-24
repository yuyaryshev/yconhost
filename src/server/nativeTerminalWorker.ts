import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import type { IPty } from "node-pty";
import { NativeControl } from "./nativeControl.js";
import type { NativeWindowState } from "./types.js";
import type { NativeStartRequest, NativeWorkerRequest, NativeWorkerResponse } from "./nativeProtocol.js";

let terminal: IPty | undefined;
let control: NativeControl | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let exiting = false;
let released = false;
let closing = false;
let state: NativeWindowState = { visible: false, cols: 160, rows: 40 };
let browserSize = { cols: 160, rows: 40 };
let hwnd: string | undefined;
let started: Promise<void> | undefined;

function send(message: NativeWorkerResponse): void {
  if (process.connected) process.send?.(message, () => undefined);
}

function release(): void {
  if (released || !terminal) return;
  released = true;
  const internal = terminal as IPty & { _isReady: boolean; _agent: { _conoutSocketWorker: { dispose(): void } } };
  internal._isReady = true;
  terminal.kill();
  internal._agent._conoutSocketWorker.dispose();
}

function finish(exitCode = 0): void {
  if (exiting) return;
  exiting = true;
  if (pollTimer) clearTimeout(pollTimer);
  if (stopTimer) clearTimeout(stopTimer);
  control?.close();
  release();
  send({ type: "exit", exitCode });
  setTimeout(() => process.exit(0), 100);
}

function kill(): void {
  if (closing || exiting) return;
  closing = true;
  stopTimer = setTimeout(() => finish(), 4000);
  if (!terminal) { finish(); return; }
  execFile("taskkill.exe", ["/pid", String(terminal.pid), "/T", "/F"], { windowsHide: true }, () => release());
}

async function readState(): Promise<NativeWindowState> {
  if (!control) throw new Error("Native control is not ready");
  const visible = await control.command("visible") === "ok 1";
  if (state.visible && !visible && terminal && !closing) terminal.resize(browserSize.cols, browserSize.rows);
  const size = (await control.command("size")).split(" ");
  const next = { visible, cols: Number(size[1]), rows: Number(size[2]), hwnd };
  if (!Number.isInteger(next.cols) || !Number.isInteger(next.rows) || next.cols < 1 || next.rows < 1) throw new Error("Invalid native viewport size");
  if (JSON.stringify(state) !== JSON.stringify(next)) send({ type: "native", state: next });
  state = next;
  return state;
}

async function poll(): Promise<void> {
  if (closing || exiting) return;
  try { await readState(); } catch (error) {
    if (!closing && !exiting) { send({ type: "failure", error: String(error) }); kill(); }
  }
  if (!closing && !exiting) pollTimer = setTimeout(() => void poll(), 250);
}

async function start(message: NativeStartRequest): Promise<void> {
  const pty = createRequire(import.meta.url)(message.runtime) as typeof import("node-pty");
  browserSize = { cols: message.options.cols, rows: message.options.rows };
  state = { visible: false, ...browserSize };
  // Only the host inherits the pipe ID; do not pass it to nested shells/ConPTY consumers.
  const env = { ...message.options.env };
  delete env.YOPENCONSOLE_PIPE_ID;
  terminal = pty.spawn(message.shell, message.args, {
    cwd: message.options.cwd, env, ...browserSize, name: "xterm-256color", useConpty: true, useConptyDll: true
  });
  terminal.onData((data) => send({ type: "data", data }));
  terminal.onExit((event) => finish(event.exitCode));
  control = new NativeControl(`\\\\.\\pipe\\yopenconsole.${message.pipeId}`);
  await control.connect();
  await control.command("close-mode hide");
  hwnd = (await control.command("hwnd")).slice(3);
  await readState();
  if (closing || exiting) return;
  send({ type: "native", state });
  send({ type: "ready", pid: terminal.pid });
  void poll();
}

process.on("message", (raw) => {
  const message = raw as NativeWorkerRequest;
  if (message.type === "start") {
    started = start(message);
    started.catch((error) => {
      if (!closing && !exiting) { send({ type: "failure", error: String(error) }); kill(); }
    });
    return;
  }
  if (message.type === "kill") { kill(); return; }
  void (async () => {
    await started;
    if (closing || exiting || !terminal) throw new Error("Native terminal is not running");
    if (message.type === "input") terminal.write(message.data);
    if (message.type === "resize") {
      browserSize = { cols: message.cols, rows: message.rows };
      if (!state.visible) terminal.resize(message.cols, message.rows);
    }
    if (message.type === "native") {
      if (typeof message.visible === "boolean") {
        await control!.command(message.visible ? "show" : "hide");
        const deadline = Date.now() + 3000;
        while ((await readState()).visible !== message.visible) {
          if (Date.now() > deadline) throw new Error("Native visibility did not change");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      send({ type: "reply", id: message.id, state: await readState() });
    }
  })().catch((error) => {
    if (message.type === "native") send({ type: "reply", id: message.id, error: String(error) });
    else if (!closing && !exiting) { send({ type: "failure", error: String(error) }); kill(); }
  });
});
process.on("disconnect", kill);
process.on("SIGTERM", kill);
process.on("SIGINT", kill);
