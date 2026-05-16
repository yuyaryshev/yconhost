import { EventEmitter } from "node:events";
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
  spawn(shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): TerminalSession;
}

export class NodePtyTerminalFactory implements TerminalFactory {
  spawn(shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): TerminalSession {
    const term = pty.spawn(shell, args, {
      cwd: options.cwd,
      env: buildTerminalEnv(options.env),
      cols: 120,
      rows: 30,
      name: "xterm-256color",
      useConpty: process.platform === "win32"
    });

    return {
      pid: term.pid,
      write: (data) => term.write(data),
      resize: (cols, rows) => term.resize(cols, rows),
      kill: (signal) => {
        if (term.pid) {
          treeKill(term.pid, signal ?? "SIGTERM", () => undefined);
        } else {
          term.kill();
        }
      },
      onData: (listener) => term.onData(listener),
      onExit: (listener) => term.onExit((event) => listener(event.exitCode))
    };
  }
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

  write(data: string): void {
    this.writes.push(data);
    this.emit("data", data);
  }

  resize(): void {
    return;
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

  spawn(): TerminalSession {
    const session = new FakeTerminalSession();
    this.sessions.push(session);
    return session;
  }
}
