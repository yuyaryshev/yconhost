import { EventEmitter } from "node:events";
import { spawn as spawnChild } from "node:child_process";
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
    const term = pty.spawn(shell, args, {
      cwd: options.cwd,
      env: buildTerminalEnv(options.env),
      cols: options.cols,
      rows: options.rows,
      name: "xterm-256color",
      useConpty: process.platform === "win32"
    });

    let released = false;
    let exited = false;
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
    });

    return {
      pid: term.pid,
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      kill: (signal) => {
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
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.FORCE_COLOR = env.FORCE_COLOR ?? "1";
  env.CLICOLOR = env.CLICOLOR ?? "1";
  env.CLICOLOR_FORCE = env.CLICOLOR_FORCE ?? "1";
  delete env.NO_COLOR;
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
