import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { analyzeOutput } from "./outputAnalyzer.js";
import type { LogStore } from "./logStore.js";
import type { TerminalFactory, TerminalSession } from "./terminal.js";
import type { AppSettings, BatchWinConfig, ConsoleCreateRequest, ConsoleRecord, ConsoleSnapshot, ProjectSummary } from "./types.js";

type OutputListener = (consoleId: string, chunk: string) => void;

interface ManagedConsole {
  record: ConsoleRecord;
  session: TerminalSession;
  tail: string;
}

export class ConsoleManager {
  private readonly consoles = new Map<string, ManagedConsole>();
  private readonly listeners = new Set<OutputListener>();

  constructor(
    private readonly settings: AppSettings,
    private readonly logs: LogStore,
    private readonly terminalFactory: TerminalFactory
  ) {}

  onOutput(listener: OutputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(project?: string): ConsoleRecord[] {
    const rows = [...this.consoles.values()].map((item) => item.record);
    return project ? rows.filter((row) => row.project === project) : rows;
  }

  listProjects(): ProjectSummary[] {
    const rows = this.list();
    const names = new Set(["Default", ...rows.map((row) => row.project)]);
    return [...names].map((name) => {
      const consoles = rows.filter((row) => row.project === name);
      return {
        name,
        consoleCount: consoles.length,
        runningCount: consoles.filter((row) => row.status === "running").length,
        readyCount: consoles.filter((row) => row.status === "ready").length,
        unseenErrorCount: consoles.reduce((sum, row) => sum + row.unseenErrorCount, 0)
      };
    });
  }

  get(id: string): ConsoleSnapshot {
    const item = this.requireConsole(id);
    item.record.unseenErrorCount = 0;
    return { ...item.record, outputTail: item.tail };
  }

  create(request: ConsoleCreateRequest): ConsoleRecord {
    if (request.projectPath) {
      throw new Error("Use /api/batch to create consoles from a project path");
    }
    const id = crypto.randomUUID();
    const cwd = path.resolve(request.cwd ?? process.cwd());
    const shell = request.shell ?? this.settings.defaultShell;
    const args = request.args ?? (request.command ? commandArgs(shell, request.command) : []);
    const now = new Date().toISOString();
    const record: ConsoleRecord = {
      id,
      name: request.name ?? request.command ?? shell,
      project: request.project ?? "Default",
      cwd,
      command: request.command ?? [shell, ...args].join(" "),
      shell,
      args,
      status: "starting",
      ansiParserEnabled: request.ansiParserEnabled ?? true,
      errorCount: 0,
      unseenErrorCount: 0,
      createdAt: now,
      updatedAt: now
    };

    const session = this.terminalFactory.spawn(shell, args, { cwd, env: process.env });
    record.pid = session.pid;
    record.status = "running";
    const managed: ManagedConsole = { record, session, tail: this.logs.read(id).slice(-this.settings.log.scrollbackBytes) };
    this.consoles.set(id, managed);

    session.onData((chunk) => this.capture(id, chunk));
    session.onExit((exitCode) => {
      record.exitCode = exitCode;
      record.status = "exited";
      record.updatedAt = new Date().toISOString();
      this.emit(id, `\r\n[yconhost] process exited with code ${exitCode ?? "unknown"}\r\n`);
    });

    return record;
  }

  createBatch(projectPath: string, fileName?: string): ConsoleRecord[] {
    if (!projectPath || typeof projectPath !== "string") {
      throw new Error("projectPath is required");
    }
    const candidates = fileName ? [fileName] : ["mywins.json", "my_wins.json"];
    const configPath = candidates.map((candidate) => path.join(projectPath, candidate)).find((candidate) => fs.existsSync(candidate));
    if (!configPath) {
      throw new Error(`No mywins.json or my_wins.json found in ${projectPath}`);
    }

    const parsed = JSON5.parse(fs.readFileSync(configPath, "utf8")) as { wins?: Record<string, BatchWinConfig> };
    return Object.entries(parsed.wins ?? {})
      .filter(([, config]) => !config.no_run)
      .map(([name, config]) =>
        this.create({
          name,
          project: path.basename(projectPath),
          cwd: config.cwd ? path.resolve(projectPath, config.cwd) : projectPath,
          command: config.cmd ?? config.command ?? "",
          ansiParserEnabled: config.ansiParserEnabled
        })
      );
  }

  readOutput(id: string, tailLines?: number): string {
    this.requireConsole(id);
    return tailLines ? this.logs.readTail(id, tailLines) : this.logs.read(id);
  }

  write(id: string, data: string): void {
    const item = this.requireConsole(id);
    item.session.write(data);
    item.record.updatedAt = new Date().toISOString();
  }

  signal(id: string, signal: string): void {
    const item = this.requireConsole(id);
    if (signal === "ctrl+c") {
      item.session.write("\x03");
    } else if (signal === "ctrl+break") {
      item.session.kill("SIGBREAK");
    } else {
      item.session.kill(signal);
    }
    item.record.updatedAt = new Date().toISOString();
  }

  restart(id: string): ConsoleRecord {
    const old = this.requireConsole(id);
    const request: ConsoleCreateRequest = {
      name: old.record.name,
      project: old.record.project,
      cwd: old.record.cwd,
      command: old.record.command,
      shell: old.record.shell,
      args: old.record.args,
      ansiParserEnabled: old.record.ansiParserEnabled
    };
    old.session.kill();
    this.consoles.delete(id);
    return this.create(request);
  }

  kill(id: string): void {
    const item = this.requireConsole(id);
    item.session.kill();
    this.consoles.delete(id);
  }

  private capture(id: string, chunk: string): void {
    const item = this.requireConsole(id);
    this.logs.append(id, chunk);
    item.tail = (item.tail + chunk).slice(-this.settings.log.scrollbackBytes);
    const trackerInput = chunk.slice(-this.settings.log.trackerTailChars);
    const result = analyzeOutput(trackerInput, item.record.ansiParserEnabled, item.record.errorCount);
    const delta = result.errorCount - item.record.errorCount;
    item.record.errorCount = result.errorCount;
    item.record.unseenErrorCount += Math.max(0, delta);
    item.record.status = result.status;
    item.record.updatedAt = new Date().toISOString();
    this.emit(id, chunk);
  }

  private emit(consoleId: string, chunk: string): void {
    for (const listener of this.listeners) {
      listener(consoleId, chunk);
    }
  }

  private requireConsole(id: string): ManagedConsole {
    const item = this.consoles.get(id);
    if (!item) {
      throw new Error(`Console ${id} not found`);
    }
    return item;
  }
}

function commandArgs(shell: string, command: string): string[] {
  const executable = path.basename(shell).toLowerCase();
  if (executable.includes("powershell")) {
    return ["-NoLogo", "-NoExit", "-Command", command];
  }
  if (executable === "cmd.exe" || executable === "cmd") {
    return ["/K", command];
  }
  return ["-lc", command];
}
