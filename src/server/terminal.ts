import { EventEmitter } from "node:events";
import { execFileSync, spawn as spawnChild } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pty from "node-pty";
import treeKill from "tree-kill";

export interface TerminalSession {
  readonly pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exitCode?: number) => void): void;
}

export interface TerminalFactory {
  spawn(shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }): TerminalSession;
}

export class PtyTerminalFactory implements TerminalFactory {
  spawn(shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }): TerminalSession {
    prepareConptyRuntime();
    const term = pty.spawn(shell, args, {
      cwd: options.cwd,
      env: buildTerminalEnv(options.env),
      cols: options.cols,
      rows: options.rows,
      name: "xterm-256color",
      useConpty: process.platform === "win32",
      useConptyDll: process.platform === "win32"
    });

    let released = false;
    let exited = false;
    let closing = false;
    const release = () => {
      if (released) return;
      released = true;
      // node-pty 1.1.0 defers kill until first output, even for silent/exited shells.
      if (process.platform === "win32") {
        (term as typeof term & { _isReady: boolean })._isReady = true;
      }
      term.kill();
    };
    term.onExit(() => {
      exited = true;
      release();
      if (process.platform === "win32") {
        // node-pty's DLL path otherwise waits for another output chunk to stop its worker.
        (term as typeof term & { _agent: { _conoutSocketWorker: { dispose(): void } } })._agent._conoutSocketWorker.dispose();
      }
    });

    return {
      pid: term.pid,
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      kill: (signal) => {
        if (closing || released) return;
        closing = true;
        if (term.pid && !exited && !released) {
          killProcessTree(term.pid, signal, release);
        } else {
          release();
        }
      },
      onData: (listener) => term.onData(listener),
      onExit: (listener) => term.onExit((event) => listener(event.exitCode))
    };
  }
}

let conptyPrepared = false;
function prepareConptyRuntime(): void {
  if (process.platform !== "win32" || conptyPrepared) return;
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("node-pty/package.json"));
  const bundled = path.join(root, "prebuilds", `win32-${process.arch}`, "conpty");
  // Locally rebuilt node-pty binaries need the bundled runtime beside them too.
  for (const build of ["Release", "Debug"]) {
    const dir = path.join(root, "build", build);
    if (fs.existsSync(path.join(dir, "conpty.node")) && !fs.existsSync(path.join(dir, "conpty", "conpty.dll"))) {
      fs.cpSync(bundled, path.join(dir, "conpty"), { recursive: true });
    }
  }
  conptyPrepared = true;
}

function killProcessTree(pid: number, signal: string | undefined, onDone: () => void): void {
  if (process.platform === "win32") {
    const child = spawnChild("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", onDone);
    child.once("exit", onDone);
    return;
  }

  treeKill(pid, signal ?? "SIGTERM", onDone);
}

export function buildTerminalEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = process.platform === "win32"
    ? mergeWindowsEnvironment(baseEnv, readWindowsEnvironment())
    : { ...baseEnv };
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.FORCE_COLOR = env.FORCE_COLOR ?? "1";
  env.CLICOLOR = env.CLICOLOR ?? "1";
  env.CLICOLOR_FORCE = env.CLICOLOR_FORCE ?? "1";
  delete env.NO_COLOR;
  return env;
}

type WindowsEnvironment = { machine: Record<string, string>; user: Record<string, string> };
let windowsEnvironment: { value: WindowsEnvironment; readAt: number } | undefined;
function readWindowsEnvironment(): WindowsEnvironment {
  if (windowsEnvironment && Date.now() - windowsEnvironment.readAt < 10_000) return windowsEnvironment.value;
  const value = JSON.parse(execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @{machine=[Environment]::GetEnvironmentVariables('Machine');user=[Environment]::GetEnvironmentVariables('User')} | ConvertTo-Json -Compress"
  ], { encoding: "utf8", windowsHide: true, timeout: 10_000 })) as WindowsEnvironment;
  windowsEnvironment = { value, readAt: Date.now() };
  return value;
}

export function mergeWindowsEnvironment(base: NodeJS.ProcessEnv, current: WindowsEnvironment): NodeJS.ProcessEnv {
  const canonical = (value: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toUpperCase(), item]));
  const machine = canonical(current.machine);
  const user = canonical(current.user);
  const inherited = canonical(base);
  const env = { ...inherited, ...machine, ...user };
  const paths = [machine.PATH, user.PATH, inherited.PATH].filter(Boolean).join(";").split(";").filter(Boolean);
  env.PATH = [...new Map(paths.map((entry) => [entry.toLowerCase(), entry])).values()].join(";");
  for (let pass = 0; pass < 3; pass++) {
    for (const key of Object.keys(env)) env[key] = env[key]?.replace(/%([^%]+)%/g, (match, name: string) => env[name.toUpperCase()] ?? match);
  }
  return env;
}

export class FakeTerminalSession extends EventEmitter implements TerminalSession {
  readonly pid = Math.floor(Math.random() * 10000) + 1000;
  readonly writes: string[] = [];
  killed = false;
  cols = 120;
  rows = 40;

  write(data: string): void {
    this.writes.push(data);
    this.emit("data", data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  kill(): void {
    this.killed = true;
    this.emit("exit", 0);
  }

  onData(listener: (chunk: string) => void): void {
    this.on("data", listener);
  }

  onExit(listener: (exitCode?: number) => void): void {
    this.on("exit", listener);
  }

  push(chunk: string): void {
    this.emit("data", chunk);
  }
}

export class FakeTerminalFactory implements TerminalFactory {
  readonly sessions: FakeTerminalSession[] = [];

  spawn(_shell: string, _args: string[], options: { cols: number; rows: number }): TerminalSession {
    const session = new FakeTerminalSession();
    session.resize(options.cols, options.rows);
    this.sessions.push(session);
    return session;
  }
}
