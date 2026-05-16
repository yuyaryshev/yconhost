import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { analyzeOutput } from "./outputAnalyzer.js";
import type { LogStore } from "./logStore.js";
import type { ConsoleStore } from "./consoleStore.js";
import type { ProjectStore } from "./projectStore.js";
import type { TerminalFactory, TerminalSession } from "./terminal.js";
import type { AppSettings, BatchWinConfig, ConsoleCreateRequest, ConsoleRecord, ConsoleSnapshot, ErrorMatch, ProjectSummary, RecentProject } from "./types.js";

type OutputListener = (consoleId: string, chunk: string) => void;

interface ManagedConsole {
  record: ConsoleRecord;
  session: TerminalSession;
  tail: string;
  errorMatches: ErrorMatch[];
}

export class ConsoleManager {
  private readonly consoles = new Map<string, ManagedConsole>();
  private readonly listeners = new Set<OutputListener>();

  constructor(
    private readonly settings: AppSettings,
    private readonly logs: LogStore,
    private readonly terminalFactory: TerminalFactory,
    private readonly store?: ConsoleStore,
    private readonly projectStore?: ProjectStore
  ) {
    for (const definition of this.store?.load() ?? []) {
      this.create(definition);
    }
  }

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
        projectPath: consoles.find((row) => row.projectPath)?.projectPath,
        consoleCount: consoles.length,
        runningCount: consoles.filter((row) => row.status === "running").length,
        readyCount: consoles.filter((row) => row.status === "ready").length,
        unseenErrorCount: consoles.reduce((sum, row) => sum + row.unseenErrorCount, 0)
      };
    });
  }

  get(id: string): ConsoleSnapshot {
    const item = this.requireConsole(id);
    return { ...item.record, outputTail: item.tail, errorMatches: item.errorMatches };
  }

  create(request: ConsoleCreateRequest): ConsoleRecord {
    const id = request.id ?? crypto.randomUUID();
    const cwd = path.resolve(request.cwd ?? process.cwd());
    const shell = request.shell ?? this.settings.defaultShell;
    const args = request.args ?? (request.command ? commandArgs(shell, request.command) : []);
    const now = new Date().toISOString();
    const record: ConsoleRecord = {
      id,
      name: request.name ?? request.command ?? shell,
      project: request.project ?? "Default",
      projectPath: request.projectPath ? path.resolve(request.projectPath) : undefined,
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
    const managed: ManagedConsole = { record, session, tail: this.logs.read(id).slice(-this.settings.log.scrollbackBytes), errorMatches: [] };
    this.consoles.set(id, managed);
    this.persist();

    session.onData((chunk) => this.capture(id, chunk));
    session.onExit((exitCode) => {
      record.exitCode = exitCode;
      record.status = "exited";
      record.updatedAt = new Date().toISOString();
      this.emit(id, `\r\n[yconhost] process exited with code ${exitCode ?? "unknown"}\r\n`);
    });

    return record;
  }

  rename(id: string, name: string): ConsoleRecord {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Console name is required");
    }
    const item = this.requireConsole(id);
    item.record.name = trimmed;
    item.record.updatedAt = new Date().toISOString();
    this.persist();
    return item.record;
  }

  createBatch(projectPath: string, fileName?: string): ConsoleRecord[] {
    if (!projectPath || typeof projectPath !== "string") {
      throw new Error("projectPath is required");
    }
    const resolvedProjectPath = path.resolve(projectPath);
    const projectName = path.basename(resolvedProjectPath);
    const existing = this.list().filter((row) => {
      const samePath = row.projectPath && path.resolve(row.projectPath).toLowerCase() === resolvedProjectPath.toLowerCase();
      const sameProjectName = row.project.toLowerCase() === projectName.toLowerCase();
      return samePath || sameProjectName;
    });
    if (existing.length > 0) {
      this.projectStore?.touch(resolvedProjectPath);
      return existing;
    }

    const candidates = fileName ? [fileName] : ["mywins.json", "my_wins.json"];
    const configPath = candidates.map((candidate) => path.join(resolvedProjectPath, candidate)).find((candidate) => fs.existsSync(candidate));
    if (!configPath) {
      throw new Error(`No mywins.json or my_wins.json found in ${resolvedProjectPath}`);
    }

    const parsed = JSON5.parse(fs.readFileSync(configPath, "utf8")) as { wins?: Record<string, BatchWinConfig> };
    this.projectStore?.touch(resolvedProjectPath);
    return Object.entries(parsed.wins ?? {})
      .filter(([, config]) => !config.no_run)
      .map(([name, config]) =>
        this.create({
          name,
          project: projectName,
          projectPath: resolvedProjectPath,
          cwd: config.cwd ? path.resolve(resolvedProjectPath, config.cwd) : resolvedProjectPath,
          command: config.cmd ?? config.command ?? "",
          ansiParserEnabled: config.ansiParserEnabled
        })
      );
  }

  recentProjects(): RecentProject[] {
    return this.projectStore?.list() ?? [];
  }

  removeRecentProject(projectPath: string): RecentProject[] {
    return this.projectStore?.remove(projectPath) ?? [];
  }

  readOutput(id: string, tailLines?: number): string {
    this.requireConsole(id);
    return tailLines ? this.logs.readTail(id, tailLines) : this.logs.read(id);
  }

  write(id: string, data: string): void {
    const item = this.requireConsole(id);
    item.session.write(data);
    item.record.updatedAt = new Date().toISOString();
    this.persist();
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
    this.persist();
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
    this.persist();
    return this.create(request);
  }

  start(id: string): ConsoleRecord {
    const old = this.requireConsole(id);
    if (old.record.status !== "exited") return old.record;
    const request = this.requestFromRecord(old.record, true);
    this.consoles.delete(id);
    this.persist();
    return this.create(request);
  }

  stop(id: string): void {
    const item = this.requireConsole(id);
    if (item.record.status !== "exited") {
      item.session.kill();
      item.record.status = "exited";
      item.record.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  markRead(id: string): ConsoleRecord {
    const item = this.requireConsole(id);
    item.record.unseenErrorCount = 0;
    item.record.errorCount = 0;
    item.record.status = item.record.status === "ready" ? "running" : item.record.status;
    item.record.updatedAt = new Date().toISOString();
    this.persist();
    return item.record;
  }

  closeProject(project: string): void {
    for (const item of this.itemsForProject(project)) {
      item.session.kill();
      this.consoles.delete(item.record.id);
    }
    this.persist();
  }

  restartProject(project: string): ConsoleRecord[] {
    return this.itemsForProject(project).map((item) => this.restart(item.record.id));
  }

  stopProject(project: string): void {
    for (const item of this.itemsForProject(project)) {
      this.stop(item.record.id);
    }
  }

  startProject(project: string): ConsoleRecord[] {
    return this.itemsForProject(project).map((item) => this.start(item.record.id));
  }

  markProjectRead(project: string): void {
    for (const item of this.itemsForProject(project)) {
      this.markRead(item.record.id);
    }
  }

  kill(id: string): void {
    const item = this.requireConsole(id);
    item.session.kill();
    this.consoles.delete(id);
    this.persist();
  }

  private capture(id: string, chunk: string): void {
    const item = this.consoles.get(id);
    if (!item) return;
    this.logs.append(id, chunk);
    item.tail = (item.tail + chunk).slice(-this.settings.log.scrollbackBytes);
    const trackerInput = chunk.slice(-this.settings.log.trackerTailChars);
    const result = analyzeOutput(trackerInput, item.record.ansiParserEnabled, item.record.errorCount);
    const delta = result.errorCount - item.record.errorCount;
    item.record.errorCount = result.errorCount;
    item.record.unseenErrorCount += Math.max(0, delta);
    item.errorMatches = [...item.errorMatches, ...result.matches].slice(-200);
    item.record.status = result.status;
    item.record.updatedAt = new Date().toISOString();
    this.persist();
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

  private persist(): void {
    this.store?.save(this.list());
  }

  private requestFromRecord(record: ConsoleRecord, preserveId = false): ConsoleCreateRequest {
    return {
      id: preserveId ? record.id : undefined,
      name: record.name,
      project: record.project,
      projectPath: record.projectPath,
      cwd: record.cwd,
      command: record.command,
      shell: record.shell,
      args: record.args,
      ansiParserEnabled: record.ansiParserEnabled
    };
  }

  private itemsForProject(project: string): ManagedConsole[] {
    const target = project.toLowerCase();
    return [...this.consoles.values()].filter((item) => item.record.project.toLowerCase() === target);
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
