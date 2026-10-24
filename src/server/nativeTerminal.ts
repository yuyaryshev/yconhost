import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { TerminalOptions, TerminalSession } from "./terminal.js";
import type { NativeWindowState } from "./types.js";

function stageRuntime(executable: string, dataDir: string): string {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("node-pty/package.json"));
  const nativeDir = ["build/Release", "build/Debug", `prebuilds/win32-${process.arch}`]
    .map((dir) => path.join(root, dir)).find((dir) => fs.existsSync(path.join(dir, "conpty.node")));
  if (!nativeDir) throw new Error("node-pty native module not found");
  const bundled = path.join(root, "prebuilds", `win32-${process.arch}`, "conpty");
  const hash = crypto.createHash("sha256");
  for (const file of [executable, path.join(nativeDir, "conpty.node"), path.join(bundled, "conpty.dll"), path.join(root, "package.json")]) hash.update(fs.readFileSync(file));
  const dir = path.resolve(dataDir, "native-runtimes", hash.digest("hex").slice(0, 24));
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    const staging = `${dir}-${crypto.randomUUID()}`;
    fs.mkdirSync(path.join(staging, "build", "Release", "conpty"), { recursive: true });
    fs.cpSync(path.join(root, "lib"), path.join(staging, "lib"), { recursive: true });
    fs.copyFileSync(path.join(nativeDir, "conpty.node"), path.join(staging, "build", "Release", "conpty.node"));
    fs.copyFileSync(path.join(bundled, "conpty.dll"), path.join(staging, "build", "Release", "conpty", "conpty.dll"));
    fs.copyFileSync(executable, path.join(staging, "build", "Release", "conpty", "OpenConsole.exe"));
    fs.copyFileSync(path.join(root, "package.json"), path.join(staging, "package.json"));
    try { fs.renameSync(staging, dir); } catch (error) { if (!fs.existsSync(dir)) throw error; }
  }
  return path.join(dir, "lib", "index.js");
}

export function spawnNativeTerminal(shell: string, args: string[], options: TerminalOptions): TerminalSession {
  if (process.platform !== "win32") throw new Error("yopenconsole requires Windows");
  if (!options.yopenconsolePath) throw new Error("yopenconsole executable path is required");
  const runtime = stageRuntime(options.yopenconsolePath, options.dataDir ?? "data");
  const worker = new URL(import.meta.url.endsWith(".ts") ? "./nativeTerminalWorker.ts" : "./nativeTerminalWorker.js", import.meta.url);
  const pipeId = crypto.randomUUID();
  const child = spawn(process.execPath, [...(worker.pathname.endsWith(".ts") ? ["--import", "tsx"] : []), fileURLToPath(worker)], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, YOPENCONSOLE_PIPE_ID: pipeId }
  });
  const events = new EventEmitter();
  let pid: number | undefined;
  let exited = false;
  let closing = false;
  let sequence = 0;
  let failure = "";
  let shellExitCode: number | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const requests = new Map<number, { resolve: (state: NativeWindowState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = (message: object) => { if (child.connected) child.send(message, (error) => { if (error && !closing) failure = error.message; }); };
  const finish = (code?: number) => {
    if (exited) return;
    exited = true;
    if (killTimer) clearTimeout(killTimer);
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error("Native terminal exited")); }
    requests.clear();
    if (failure) events.emit("data", `\r\n[yconhost] native backend: ${failure}\r\n`);
    events.emit("exit", code);
  };
  child.stderr?.on("data", (data: Buffer) => { failure = (failure + data.toString()).slice(-4096); });
  child.on("message", (message: any) => {
    if (message.type === "ready") { pid = message.pid; events.emit("ready", pid); }
    if (message.type === "data") events.emit("data", message.data);
    if (message.type === "native") events.emit("native", message.state);
    if (message.type === "reply") {
      const request = requests.get(message.id);
      if (request) { clearTimeout(request.timer); requests.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.state); }
    }
    if (message.type === "failure") failure = message.error;
    if (message.type === "exit") shellExitCode = message.exitCode;
  });
  child.once("error", (error) => { failure = error.message; finish(1); });
  child.once("exit", (code) => finish(shellExitCode ?? code ?? undefined));
  send({ type: "start", shell, args, options, runtime, pipeId });
  return {
    get pid() { return pid; },
    write: (data) => { if (!closing && !exited) send({ type: "input", data }); },
    resize: (cols, rows) => { if (!closing && !exited) send({ type: "resize", cols, rows }); },
    kill: () => {
      if (closing || exited) return;
      closing = true;
      send({ type: "kill" });
      killTimer = setTimeout(() => {
        // Kill the worker's complete tree if native teardown itself gets stuck.
        import("node:child_process").then(({ execFile }) => execFile("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined));
      }, 5000);
    },
    onData: (listener) => { events.on("data", listener); },
    onExit: (listener) => { events.on("exit", listener); },
    onReady: (listener) => { events.on("ready", listener); },
    onNativeWindow: (listener) => { events.on("native", listener); },
    nativeWindow: (visible) => new Promise((resolve, reject) => {
      if (closing || exited) return reject(new Error("Native terminal is not running"));
      const id = ++sequence;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error("Native window request timed out")); }, 15_000);
      requests.set(id, { resolve, reject, timer });
      send({ type: "native", id, visible });
    })
  };
}
