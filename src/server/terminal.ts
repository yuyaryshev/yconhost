import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import pty from "node-pty";
import treeKill from "tree-kill";

export interface TerminalSession {
  readonly pid?: number;
  readonly vanillaVisible?: boolean;
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
      env: options.env,
      cols: 120,
      rows: 30,
      name: "xterm-color",
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

export class VisibleWindowTerminalFactory implements TerminalFactory {
  spawn(shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): TerminalSession {
    if (process.platform !== "win32") {
      throw new Error("visible-window terminal backend is only supported on Windows");
    }

    const payload = Buffer.from(JSON.stringify({ shell, args, cwd: options.cwd }), "utf8").toString("base64");
    const script = `
$ErrorActionPreference = 'Stop'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$process = Start-Process -FilePath $payload.shell -ArgumentList @($payload.args) -WorkingDirectory $payload.cwd -WindowStyle Normal -PassThru
[pscustomobject]@{ pid = $process.Id } | ConvertTo-Json -Compress
`;
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8"
    }).trim();
    const parsed = JSON.parse(raw) as { pid: number };
    return new VisibleWindowTerminalSession(parsed.pid);
  }
}

class VisibleWindowTerminalSession extends EventEmitter implements TerminalSession {
  readonly vanillaVisible = true;
  private readonly timer: NodeJS.Timeout;
  private exited = false;

  constructor(readonly pid: number) {
    super();
    setTimeout(() => {
      this.emit(
        "data",
        `[yconhost] Started as a normal visible Windows console window (PID ${pid}). Web terminal streaming/input is disabled for this temporary backend.\r\n`
      );
    }, 0);
    this.timer = setInterval(() => this.pollExit(), 1000);
    this.timer.unref();
  }

  write(data: string): void {
    this.emit("data", `[yconhost] Web input ignored by visible-window backend: ${JSON.stringify(data)}\r\n`);
  }

  resize(): void {
    return;
  }

  kill(signal?: string): void {
    treeKill(this.pid, signal ?? "SIGTERM", () => undefined);
  }

  onData(listener: (chunk: string) => void): void {
    this.on("data", listener);
  }

  onExit(listener: (exitCode?: number) => void): void {
    this.on("exit", listener);
  }

  private pollExit(): void {
    if (this.exited) {
      return;
    }
    try {
      process.kill(this.pid, 0);
    } catch {
      this.exited = true;
      clearInterval(this.timer);
      this.emit("exit", 0);
    }
  }
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
