import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import xtermHeadless from "@xterm/headless";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import JSON5 from "json5";
import { extractCardsFromText, mergeCards } from "./cardExtractor.js";
import { loadCodexContextPresets } from "./codexContexts.js";
import type { LogStore } from "./logStore.js";
import type { ConsoleStore } from "./consoleStore.js";
import type { ProjectStore } from "./projectStore.js";
import type { TerminalFactory, TerminalSession } from "./terminal.js";
import type { AppSettings, BatchWinConfig, CodexContextsImportRequest, CodexContextsImportResult, ConsoleCreateRequest, ConsoleRecord, ConsoleRegisterRequest, ConsoleSessionState, ConsoleSnapshot, ErrorMatch, ExtractedCard, ManagedProject, MywinsEntry, ProjectSummary, RecentProject, ThemeColorPair } from "./types.js";

type OutputListener = (consoleId: string, chunk: string) => void;
const { Terminal } = xtermHeadless as typeof import("@xterm/headless");

interface ManagedConsole {
  record: ConsoleRecord;
  session?: TerminalSession;
  mirror: HeadlessTerminal;
  tail: string;
  cards: ExtractedCard[];
  readHashes: Set<string>;
  cardRefreshTimer?: ReturnType<typeof setTimeout>;
}

export class ConsoleManager {
  private readonly consoles = new Map<string, ManagedConsole>();
  private readonly listeners = new Set<OutputListener>();
  private persistTimer?: ReturnType<typeof setTimeout>;
  private readonly managedProjects = new Set<string>();

  constructor(
    private settings: AppSettings,
    private readonly logs: LogStore,
    private readonly terminalFactory: TerminalFactory,
    private readonly store?: ConsoleStore,
    private readonly projectStore?: ProjectStore
  ) {
    for (const project of this.projectStore?.listManagedProjects() ?? []) {
      this.managedProjects.add(project.name);
    }
    for (const definition of this.store?.load() ?? []) {
      this.createManaged(definition, false);
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
    const names = new Set(["Default", ...this.managedProjects, ...rows.map((row) => row.project)]);
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
    return { ...item.record, outputTail: item.tail, errorMatches: cardsToMatches(item.cards), cards: item.cards };
  }

  getState(id: string, tailLines = 8): ConsoleSessionState {
    const item = this.requireConsole(id);
    const safeTailLines = Math.max(1, Math.min(100, Math.floor(tailLines)));
    const tail = this.logs.readTail(id, safeTailLines);
    return { ...item.record, tail, tailLines: splitTailLines(tail) };
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  updateSettings(settings: AppSettings): AppSettings {
    this.settings = settings;
    for (const item of this.consoles.values()) {
      item.mirror.resize(settings.terminal.cols, settings.terminal.rows);
      item.session?.resize(settings.terminal.cols, settings.terminal.rows);
      item.tail = this.logs.read(item.record.id).slice(-settings.log.scrollbackBytes);
      this.refreshCards(item);
    }
    return this.settings;
  }

  create(request: ConsoleCreateRequest): ConsoleRecord {
    return this.createManaged(request, true);
  }

  createProject(name: string): ManagedProject {
    const project = this.projectStore?.createManagedProject(name) ?? { name: name.trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (!project.name) throw new Error("Project name is required");
    this.managedProjects.add(project.name);
    return project;
  }

  registerConsole(request: ConsoleRegisterRequest): ConsoleRecord {
    this.createProject(request.project);
    return this.createManaged(request, request.start === true && !request.noRun);
  }

  importCodexContexts(request: CodexContextsImportRequest = {}): CodexContextsImportResult {
    const project = request.project?.trim() || this.settings.codexContexts.projectName;
    this.createProject(project);
    const slots = loadCodexContextPresets({
      project,
      contextsPath: request.contextsPath ?? this.settings.codexContexts.contextsPath,
      weztermPresetsPath: request.weztermPresetsPath ?? this.settings.codexContexts.weztermPresetsPath,
      defaultCwd: process.cwd()
    });
    const consoles = slots.map((slot) => this.upsertManagedSlot(slot));
    this.reorderProject(project, consoles.map((record) => record.id));
    this.persist();
    return { project, imported: consoles.length, consoles };
  }

  private createManaged(request: ConsoleCreateRequest, startProcess: boolean): ConsoleRecord {
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
      noRun: request.noRun,
      autoStartOnOpen: request.autoStartOnOpen,
      status: startProcess ? "starting" : "idle",
      ansiParserEnabled: request.ansiParserEnabled ?? true,
      readCardHashes: request.readCardHashes ?? [],
      errorCount: 0,
      unseenErrorCount: 0,
      createdAt: now,
      updatedAt: now,
      lastInputAt: request.lastInputAt,
      lastOutputAt: request.lastOutputAt,
      background: request.background,
      backgroundColor: request.backgroundColor ?? resolveConsoleBackground(request.background)
    };

    const mirror = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cols: this.settings.terminal.cols,
      rows: this.settings.terminal.rows,
      scrollback: this.settings.terminal.scrollback
    });
    const tail = this.logs.read(id).slice(-this.settings.log.scrollbackBytes);
    const managed: ManagedConsole = { record, mirror, tail, cards: [], readHashes: new Set(record.readCardHashes ?? []) };
    if (tail) mirror.write(tail);
    this.refreshCards(managed);
    this.consoles.set(id, managed);
    this.persist();

    if (startProcess) {
      try {
        const session = this.terminalFactory.spawn(shell, args, {
          cwd,
          env: process.env,
          cols: this.settings.terminal.cols,
          rows: this.settings.terminal.rows
        });
        managed.session = session;
        record.pid = session.pid;
        record.status = "running";
        this.persist();

        session.onData((chunk) => this.capture(managed, chunk));
        session.onExit((exitCode) => {
          if (this.consoles.get(id) !== managed) return;
          record.exitCode = exitCode;
          record.pid = undefined;
          record.status = "exited";
          record.updatedAt = new Date().toISOString();
          managed.session = undefined;
          this.capture(managed, `\r\n[yconhost] process exited with code ${exitCode ?? "unknown"}\r\n`);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown terminal spawn error";
        record.pid = undefined;
        record.status = "exited";
        record.updatedAt = new Date().toISOString();
        this.capture(managed, `\r\n[yconhost] failed to start console: ${message}\r\n`);
        console.error(`[yconhost] failed to start console ${record.id} (${record.name}): ${message}`);
      }
    }

    return record;
  }

  private upsertManagedSlot(request: ConsoleRegisterRequest): ConsoleRecord {
    const existing = this.findConsoleByProjectAndName(request.project, request.name ?? request.command ?? request.shell ?? "console");
    if (!existing) {
      return this.createManaged({
        ...request,
        id: managedConsoleId(request.project, request.name ?? request.command ?? request.shell ?? "console")
      }, request.start === true && !request.noRun);
    }

    const shell = request.shell ?? this.settings.defaultShell;
    const command = request.command ?? [shell, ...(request.args ?? [])].join(" ");
    const cwd = path.resolve(request.cwd ?? existing.record.cwd);
    existing.record.cwd = cwd;
    existing.record.command = command;
    existing.record.shell = shell;
    existing.record.args = request.args ?? (request.command ? commandArgs(shell, request.command) : []);
    existing.record.noRun = request.noRun;
    existing.record.autoStartOnOpen = request.autoStartOnOpen;
    existing.record.ansiParserEnabled = request.ansiParserEnabled ?? true;
    existing.record.background = request.background;
    existing.record.backgroundColor = request.backgroundColor ?? resolveConsoleBackground(request.background);
    existing.record.updatedAt = new Date().toISOString();
    return existing.record;
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

  createBatch(projectPath: string, fileName?: string, options: { removeMissing?: boolean } = {}): ConsoleRecord[] {
    if (!projectPath || typeof projectPath !== "string") {
      throw new Error("projectPath is required");
    }
    const resolvedProjectPath = path.resolve(projectPath);
    const projectName = path.basename(resolvedProjectPath);
    const candidates = fileName ? [fileName] : ["mywins.json", "my_wins.json"];
    const configPath = candidates.map((candidate) => path.join(resolvedProjectPath, candidate)).find((candidate) => fs.existsSync(candidate));
    if (!configPath) {
      throw new Error(`No mywins.json or my_wins.json found in ${resolvedProjectPath}`);
    }

    const parsed = readMywinsFile(configPath);
    this.projectStore?.touch(resolvedProjectPath);
    const orderedIds: string[] = [];
    const records = Object.entries(parsed.wins ?? {}).map(([name, config]) => {
      const existing = this.findProjectConsole(resolvedProjectPath, projectName, name);
      const request = {
        id: existing?.record.id ?? batchConsoleId(resolvedProjectPath, name),
        name,
        project: projectName,
        projectPath: resolvedProjectPath,
        cwd: config.cwd ? path.resolve(resolvedProjectPath, config.cwd) : resolvedProjectPath,
        command: config.cmd ?? config.command ?? "",
        noRun: config.no_run === true,
        background: config.background ?? config.backgroung,
        backgroundColor: resolveConsoleBackground(config.background ?? config.backgroung),
        ansiParserEnabled: config.ansiParserEnabled,
        readCardHashes: existing?.record.readCardHashes
      };

      if (existing) {
        existing.record.projectPath = request.projectPath;
        existing.record.cwd = request.cwd;
        existing.record.command = request.command;
        existing.record.noRun = request.noRun;
        existing.record.background = request.background;
        existing.record.backgroundColor = request.backgroundColor;
        existing.record.shell = this.settings.defaultShell;
        existing.record.args = request.command ? commandArgs(existing.record.shell, request.command) : [];
        existing.record.ansiParserEnabled = request.ansiParserEnabled ?? true;
        existing.record.updatedAt = new Date().toISOString();
        orderedIds.push(existing.record.id);
        return existing.record;
      }

      const record = this.createManaged(request, !request.noRun);
      orderedIds.push(record.id);
      return record;
    });
    if (options.removeMissing) {
      const keep = new Set(orderedIds);
      for (const item of [...this.consoles.values()]) {
        if (item.record.projectPath && path.resolve(item.record.projectPath).toLowerCase() === resolvedProjectPath.toLowerCase() && !keep.has(item.record.id)) {
          item.session?.kill();
          if (item.cardRefreshTimer) clearTimeout(item.cardRefreshTimer);
          this.consoles.delete(item.record.id);
        }
      }
    }
    this.reorderProject(projectName, orderedIds);
    this.persist();
    return records;
  }

  reloadProjectConfig(project: string): ConsoleRecord[] {
    const projectItems = this.itemsForProject(project);
    const projectPath = projectItems.find((item) => item.record.projectPath)?.record.projectPath;
    if (!projectPath) {
      throw new Error(`Project ${project} has no mywins.json project path`);
    }
    return this.createBatch(projectPath, undefined, { removeMissing: true });
  }

  getMywinsEntry(id: string): MywinsEntry {
    const item = this.requireConsole(id);
    const { configPath, parsed } = this.readMywinsForRecord(item.record);
    const config = parsed.wins?.[item.record.name];
    if (!config) {
      throw new Error(`Console ${item.record.name} is not present in ${path.basename(configPath)}`);
    }
    return configToMywinsEntry(item.record.name, config);
  }

  updateMywinsEntry(id: string, entry: MywinsEntry): ConsoleRecord[] {
    const item = this.requireConsole(id);
    const { configPath, parsed } = this.readMywinsForRecord(item.record);
    const currentName = item.record.name;
    const nextName = normalizeMywinsName(entry.name);
    const wins = parsed.wins ?? {};
    if (!wins[currentName]) throw new Error(`Console ${currentName} is not present in ${path.basename(configPath)}`);
    if (nextName !== currentName && wins[nextName]) throw new Error(`Console ${nextName} already exists in ${path.basename(configPath)}`);
    parsed.wins = replaceMywinsEntry(wins, currentName, nextName, entryToConfig(entry));
    writeMywinsFile(configPath, parsed);
    return this.createBatch(item.record.projectPath!, undefined, { removeMissing: true });
  }

  addMywinsEntry(project: string, entry: MywinsEntry): ConsoleRecord[] {
    const projectPath = this.projectPathForProject(project);
    const configPath = findMywinsPath(projectPath);
    const parsed = readMywinsFile(configPath);
    const name = normalizeMywinsName(entry.name);
    const wins = parsed.wins ?? {};
    if (wins[name]) throw new Error(`Console ${name} already exists in ${path.basename(configPath)}`);
    parsed.wins = { ...wins, [name]: entryToConfig({ ...entry, name }) };
    writeMywinsFile(configPath, parsed);
    return this.createBatch(projectPath, undefined, { removeMissing: true });
  }

  deleteMywinsEntry(id: string): ConsoleRecord[] {
    const item = this.requireConsole(id);
    const { configPath, parsed } = this.readMywinsForRecord(item.record);
    if (!parsed.wins?.[item.record.name]) throw new Error(`Console ${item.record.name} is not present in ${path.basename(configPath)}`);
    const { [item.record.name]: _removed, ...nextWins } = parsed.wins;
    parsed.wins = nextWins;
    writeMywinsFile(configPath, parsed);
    return this.createBatch(item.record.projectPath!, undefined, { removeMissing: true });
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
    if (!item.session) {
      throw new Error(`Console ${id} is not running`);
    }
    item.session.write(data);
    const now = new Date().toISOString();
    item.record.lastInputAt = now;
    item.record.updatedAt = now;
    this.persist();
  }

  async runCommand(id: string, command: string, options: { wait?: boolean; timeoutMs?: number } = {}): Promise<{ status: "started" | "completed"; id: string; command: string; output?: string; exitCode?: number; timedOut?: boolean }> {
    const item = this.requireConsole(id);
    if (!item.session) {
      throw new Error(`Console ${id} is not running`);
    }
    const normalizedCommand = command.trimEnd();
    if (!normalizedCommand) {
      throw new Error("command is required");
    }
    if (!options.wait) {
      item.session.write(`${normalizedCommand}${lineEnding(item.record.shell)}`);
      const now = new Date().toISOString();
      item.record.lastInputAt = now;
      item.record.updatedAt = now;
      this.persist();
      return { status: "started", id, command: normalizedCommand };
    }

    const marker = `__YCONHOST_DONE_${crypto.randomBytes(8).toString("hex")}__`;
    const timeoutMs = Math.max(1000, Math.min(10 * 60 * 1000, Math.floor(options.timeoutMs ?? 30000)));
    let output = "";
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribe();
      };
      const unsubscribe = this.onOutput((consoleId, chunk) => {
        if (consoleId !== id) return;
        output += chunk;
        const markerIndex = output.indexOf(marker);
        if (markerIndex < 0) return;
        const markerTail = output.slice(markerIndex);
        const exitCode = Number(markerTail.match(new RegExp(`${marker}:(-?\\d+)`))?.[1] ?? "0");
        cleanup();
        resolve({ status: "completed", id, command: normalizedCommand, output: output.slice(0, markerIndex), exitCode });
      });
      const timer = setTimeout(() => {
        cleanup();
        resolve({ status: "completed", id, command: normalizedCommand, output, timedOut: true });
      }, timeoutMs);
      try {
        item.session?.write(commandWithCompletionMarker(item.record.shell, normalizedCommand, marker));
        const now = new Date().toISOString();
        item.record.lastInputAt = now;
        item.record.updatedAt = now;
        this.persist();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  resize(id: string, cols: number, rows: number): void {
    const item = this.requireConsole(id);
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
    item.session?.resize(safeCols, safeRows);
    item.mirror.resize(safeCols, safeRows);
    this.refreshCards(item);
  }

  signal(id: string, signal: string): void {
    const item = this.requireConsole(id);
    if (!item.session) {
      throw new Error(`Console ${id} is not running`);
    }
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
    const request = this.requestFromRecord(old.record, true);
    old.session?.kill();
    return this.createManaged(request, true);
  }

  start(id: string): ConsoleRecord {
    const old = this.requireConsole(id);
    if (old.session) return old.record;
    const request = this.requestFromRecord(old.record, true);
    return this.createManaged(request, true);
  }

  stop(id: string): void {
    const item = this.requireConsole(id);
    if (item.session) {
      item.session.kill();
      item.session = undefined;
      item.record.pid = undefined;
      item.record.status = "exited";
      item.record.updatedAt = new Date().toISOString();
      this.persist();
    }
  }

  markRead(id: string): ConsoleRecord {
    const item = this.requireConsole(id);
    item.record.unseenErrorCount = 0;
    for (const card of item.cards) {
      item.readHashes.add(card.hash);
    }
    item.record.readCardHashes = [...item.readHashes];
    item.record.status = item.record.status === "ready" ? "running" : item.record.status;
    item.record.updatedAt = new Date().toISOString();
    this.persist();
    return item.record;
  }

  closeProject(project: string): void {
    for (const item of this.itemsForProject(project)) {
      item.session?.kill();
      if (item.cardRefreshTimer) clearTimeout(item.cardRefreshTimer);
      this.consoles.delete(item.record.id);
    }
    this.managedProjects.delete(project);
    this.projectStore?.removeManagedProject(project);
    this.persist();
  }

  restartProject(project: string): ConsoleRecord[] {
    return this.itemsForProject(project).map((item) => this.restart(item.record.id));
  }

  restartProjectExceptNoRun(project: string): ConsoleRecord[] {
    const items = this.itemsForProject(project);
    for (const item of items) {
      this.stop(item.record.id);
    }
    return items.filter((item) => !item.record.noRun).map((item) => this.start(item.record.id));
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
    item.session?.kill();
    if (item.record.project === "Default") {
      if (item.cardRefreshTimer) clearTimeout(item.cardRefreshTimer);
      this.consoles.delete(id);
      this.persist();
      return;
    }
    item.session = undefined;
    item.record.pid = undefined;
    item.record.status = "idle";
    item.record.updatedAt = new Date().toISOString();
    this.persist();
  }

  private capture(item: ManagedConsole, chunk: string): void {
    if (this.consoles.get(item.record.id) !== item) return;
    this.logs.append(item.record.id, chunk);
    item.tail = (item.tail + chunk).slice(-this.settings.log.scrollbackBytes);
    const now = new Date().toISOString();
    item.record.lastOutputAt = now;
    item.record.updatedAt = now;
    this.scheduleCardRefresh(item);
    this.schedulePersist();
    this.emit(item.record.id, chunk);
  }

  private scheduleCardRefresh(item: ManagedConsole): void {
    if (item.cardRefreshTimer) return;
    item.cardRefreshTimer = setTimeout(() => {
      item.cardRefreshTimer = undefined;
      if (this.consoles.get(item.record.id) !== item) return;
      this.refreshCards(item);
      this.schedulePersist();
    }, 500);
  }

  private refreshCards(item: ManagedConsole): void {
    const log = this.logs.read(item.record.id).slice(-this.settings.cards.scanTailBytes);
    const persistent = extractCardsFromText(log, this.settings.cards.maxPerConsole);
    item.cards = mergeCards(persistent, [], this.settings.cards.maxPerConsole);
    const errorCards = item.cards.filter((card) => card.category === "error");
    item.record.errorCount = errorCards.length;
    item.record.unseenErrorCount = errorCards.filter((card) => !item.readHashes.has(card.hash)).length;
    if (item.session && item.record.status !== "exited") {
      item.record.status = item.record.unseenErrorCount > 0 ? "ready" : "running";
    }
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
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.store?.save(this.list());
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.store?.save(this.list());
    }, 500);
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
      noRun: record.noRun,
      autoStartOnOpen: record.autoStartOnOpen,
      ansiParserEnabled: record.ansiParserEnabled,
      readCardHashes: record.readCardHashes,
      lastInputAt: record.lastInputAt,
      lastOutputAt: record.lastOutputAt,
      background: record.background,
      backgroundColor: record.backgroundColor
    };
  }

  private itemsForProject(project: string): ManagedConsole[] {
    const target = project.toLowerCase();
    return [...this.consoles.values()].filter((item) => item.record.project.toLowerCase() === target);
  }

  private findProjectConsole(projectPath: string, projectName: string, name: string): ManagedConsole | undefined {
    const targetPath = path.resolve(projectPath).toLowerCase();
    return [...this.consoles.values()].find((item) => {
      const samePath = item.record.projectPath && path.resolve(item.record.projectPath).toLowerCase() === targetPath;
      const sameProject = item.record.project.toLowerCase() === projectName.toLowerCase();
      return (samePath || sameProject) && item.record.name === name;
    });
  }

  private findConsoleByProjectAndName(project: string, name: string): ManagedConsole | undefined {
    const targetProject = project.toLowerCase();
    return [...this.consoles.values()].find((item) => item.record.project.toLowerCase() === targetProject && item.record.name === name);
  }

  private reorderProject(project: string, orderedIds: string[]): void {
    const target = project.toLowerCase();
    const ordered = new Set(orderedIds);
    const next = new Map<string, ManagedConsole>();
    for (const item of this.consoles.values()) {
      if (item.record.project.toLowerCase() !== target) {
        next.set(item.record.id, item);
      }
    }
    for (const id of orderedIds) {
      const item = this.consoles.get(id);
      if (item) next.set(id, item);
    }
    for (const item of this.consoles.values()) {
      if (item.record.project.toLowerCase() === target && !ordered.has(item.record.id)) {
        next.set(item.record.id, item);
      }
    }
    this.consoles.clear();
    for (const [id, item] of next) {
      this.consoles.set(id, item);
    }
  }

  private projectPathForProject(project: string): string {
    const projectPath = this.itemsForProject(project).find((item) => item.record.projectPath)?.record.projectPath;
    if (!projectPath) {
      throw new Error(`Project ${project} has no mywins.json project path`);
    }
    return projectPath;
  }

  private readMywinsForRecord(record: ConsoleRecord): { configPath: string; parsed: MywinsDocument } {
    if (!record.projectPath) {
      throw new Error(`Console ${record.id} is not backed by mywins.json`);
    }
    const configPath = findMywinsPath(record.projectPath);
    return { configPath, parsed: readMywinsFile(configPath) };
  }
}

interface MywinsDocument {
  wins?: Record<string, BatchWinConfig>;
  [key: string]: unknown;
}

function batchConsoleId(projectPath: string, name: string): string {
  return `batch-${crypto.createHash("sha1").update(`${path.resolve(projectPath).toLowerCase()}\0${name}`).digest("hex")}`;
}

function managedConsoleId(project: string, name: string): string {
  return `managed-${crypto.createHash("sha1").update(`${project.toLowerCase()}\0${name}`).digest("hex")}`;
}

function findMywinsPath(projectPath: string, fileName?: string): string {
  const resolvedProjectPath = path.resolve(projectPath);
  const candidates = fileName ? [fileName] : ["mywins.json", "my_wins.json"];
  const configPath = candidates.map((candidate) => path.join(resolvedProjectPath, candidate)).find((candidate) => fs.existsSync(candidate));
  if (!configPath) {
    throw new Error(`No mywins.json or my_wins.json found in ${resolvedProjectPath}`);
  }
  return configPath;
}

function readMywinsFile(configPath: string): MywinsDocument {
  return JSON5.parse(fs.readFileSync(configPath, "utf8")) as MywinsDocument;
}

function writeMywinsFile(configPath: string, parsed: MywinsDocument): void {
  fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function normalizeMywinsName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Console name is required");
  return trimmed;
}

function configToMywinsEntry(name: string, config: BatchWinConfig): MywinsEntry {
  return {
    name,
    cmd: config.cmd,
    command: config.command,
    cwd: config.cwd,
    no_run: config.no_run,
    ansiParserEnabled: config.ansiParserEnabled,
    background: config.background ?? config.backgroung
  };
}

function entryToConfig(entry: MywinsEntry): BatchWinConfig {
  return {
    cmd: entry.cmd ?? entry.command ?? "",
    cwd: entry.cwd || undefined,
    no_run: entry.no_run === true ? true : undefined,
    ansiParserEnabled: entry.ansiParserEnabled,
    background: entry.background?.trim() || undefined
  };
}

function replaceMywinsEntry(wins: Record<string, BatchWinConfig>, currentName: string, nextName: string, config: BatchWinConfig): Record<string, BatchWinConfig> {
  const next: Record<string, BatchWinConfig> = {};
  for (const [name, value] of Object.entries(wins)) {
    if (name === currentName) {
      next[nextName] = config;
    } else {
      next[name] = value;
    }
  }
  return next;
}

function resolveConsoleBackground(value?: string): ThemeColorPair | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const std = stdBackground(raw);
  if (std) return std;
  const rgb = parseRgb(raw);
  return rgb ? { dark: rgbToCss(rgb), light: rgbToCss(rgb) } : undefined;
}

function stdBackground(value: string): ThemeColorPair | undefined {
  const key = value.trim().toUpperCase();
  const channels: Record<string, [number, number, number]> = {
    STD_BLACK: [0, 0, 0],
    STD_RED: [1, 0, 0],
    STD_GREEN: [0, 1, 0],
    STD_BLUE: [0, 0, 1],
    STD_YELLOW: [1, 1, 0],
    STD_CYAN: [0, 1, 1],
    STD_MAGENTA: [1, 0, 1],
    STD_WHITE: [1, 1, 1],
    STD_GRAY: [1, 1, 1],
    STD_GREY: [1, 1, 1]
  };
  const channel = channels[key];
  if (!channel) return undefined;
  const dark = channel.map((enabled) => (enabled ? 20 : 12)) as [number, number, number];
  const light = channel.map((enabled) => (enabled ? 255 : 247)) as [number, number, number];
  return { dark: rgbToCss(dark), light: rgbToCss(light) };
}

function parseRgb(value: string): [number, number, number] | undefined {
  const match = value.match(/^#?([0-9a-f]{6})$/i);
  if (match) {
    const hex = match[1];
    return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
  }
  const rgb = value.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i) ?? value.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (!rgb) return undefined;
  const parsed = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as [number, number, number];
  return parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255) ? parsed : undefined;
}

function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function cardsToMatches(cards: ExtractedCard[]): ErrorMatch[] {
  return cards
    .filter((card) => card.category === "error")
    .map((card) => ({
      id: card.id,
      createdAt: card.createdAt,
      line: card.title,
      reason: "extracted card"
    }));
}

function splitTailLines(tail: string): string[] {
  if (!tail) return [];
  const lines = tail.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
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

function lineEnding(shell: string): string {
  const executable = path.basename(shell).toLowerCase();
  return executable.includes("cmd") || executable.includes("powershell") || executable.includes("pwsh") ? "\r" : "\n";
}

function commandWithCompletionMarker(shell: string, command: string, marker: string): string {
  const executable = path.basename(shell).toLowerCase();
  const end = lineEnding(shell);
  if (executable.includes("cmd")) {
    return `${command}${end}echo ${marker}:%ERRORLEVEL%${end}`;
  }
  if (executable.includes("powershell") || executable.includes("pwsh")) {
    return `${command}${end}Write-Output "${marker}:$LASTEXITCODE"${end}`;
  }
  return `${command}${end}echo ${marker}:$?${end}`;
}
