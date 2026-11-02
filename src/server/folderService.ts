import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { resolveConsoleBackground } from "../shared/colors.js";
import type { ConsoleManager } from "./consoleManager.js";
import { FolderRunner } from "./folderRunner.js";
import { defaultFolderFields, type FolderCapabilities, type FolderConfig, type FolderField, type FolderInfo, type FolderItem } from "./folderTypes.js";
import { ProjectStore } from "./projectStore.js";
import type { BatchWinConfig, ConsoleRecord, ManagedProject, MywinsEntry } from "./types.js";

const editable: FolderCapabilities = { create: true, update: true, delete: true, readOutput: false };
const noCapabilities: FolderCapabilities = { create: false, update: false, delete: false, readOutput: false };
const manualFields: FolderField[] = [...defaultFolderFields,
  { name: "command", label: "Command", type: "string" }, { name: "cwd", label: "Working directory", type: "string" },
  { name: "background", label: "Background", type: "color" }];
const mywinsFields: FolderField[] = [...manualFields, { name: "no_run", label: "no_run (true/false)", type: "string" }, { name: "ansiParserEnabled", label: "ANSI parser (true/false)", type: "string" }];

interface State { info: FolderInfo; runner?: FolderRunner; queue: Promise<unknown>; timer?: ReturnType<typeof setTimeout> }

export class FolderService {
  private readonly states = new Map<string, State>();
  private disposed = false;
  readonly store: ProjectStore;

  constructor(private readonly manager: ConsoleManager, private readonly timeoutMs = 10_000) {
    this.store = new ProjectStore(manager.getSettings());
    const saved = this.store.listManagedProjects();
    const names = new Set(["Default", ...saved.map((item) => item.name), ...manager.list().map((item) => item.project)]);
    for (const name of names) {
      const previous = saved.find((item) => item.name.toLowerCase() === name.toLowerCase());
      const projectPath = previous?.projectPath ?? manager.list(name).find((item) => item.projectPath)?.projectPath;
      this.addState({ ...previous, name, id: previous?.id ?? crypto.randomUUID(), type: previous?.type ?? (projectPath ? "my_wins" : "manual"),
        projectPath, intervalSeconds: previous?.intervalSeconds ?? 60, closeRemoves: previous?.closeRemoves ?? name === "Default",
        gatherErrors: previous?.gatherErrors ?? true, capabilities: previous?.type === "scripted" ? { ...noCapabilities } : { ...editable } });
    }
  }

  list(): FolderInfo[] { return [...this.states.values()].map((state) => state.info); }
  get(project: string): FolderInfo { return this.require(project).info; }

  adoptRegistry(): void {
    for (const project of this.store.listManagedProjects()) {
      const state = this.states.get(project.name.toLowerCase());
      const info: FolderInfo = { ...state?.info, ...project, id: project.id ?? state?.info.id ?? crypto.randomUUID(), type: project.type ?? "manual", capabilities: project.type === "scripted" ? { ...noCapabilities } : { ...editable } };
      if (state) this.stopState(state);
      this.addState(info);
    }
  }

  async initialize(): Promise<void> {
    await Promise.all(this.list().filter((folder) => folder.type !== "manual").map((folder) => this.listFolder(folder.id).catch(() => undefined)));
  }

  async configure(config: FolderConfig): Promise<FolderInfo> {
    if (typeof config.name !== "string" || !config.name.trim()) throw new Error("Folder name is required");
    const existing = this.states.get(config.name.trim().toLowerCase());
    if (config.id && existing?.info.id !== config.id) throw new Error("Folder identity mismatch");
    const info: FolderInfo = { ...existing?.info, ...config, name: config.name.trim(), id: existing?.info.id ?? crypto.randomUUID(),
      intervalSeconds: config.intervalSeconds ?? existing?.info.intervalSeconds ?? 60,
      gatherErrors: config.gatherErrors ?? existing?.info.gatherErrors ?? true, capabilities: { ...editable } };
    if (!["manual", "my_wins", "scripted"].includes(info.type)) throw new Error("Unknown folder type");
    if (!Number.isFinite(info.intervalSeconds) || info.intervalSeconds! < 0 || info.intervalSeconds! > 86400) throw new Error("Update interval must be 0..86400 seconds");
    if (info.type === "scripted") {
      if (!info.scriptPath || !path.isAbsolute(info.scriptPath) || !fs.statSync(info.scriptPath).isFile()) throw new Error("An absolute local scriptPath is required");
      info.scriptPath = path.resolve(info.scriptPath);
      if (this.list().some((other) => other.id !== info.id && other.type === "scripted" && other.scriptPath?.toLowerCase() === info.scriptPath!.toLowerCase())) throw new Error("One folder per JS file: this script is already registered");
    } else info.scriptPath = undefined;
    if (info.type === "my_wins") {
      if (!info.projectPath) throw new Error("projectPath is required for my_wins");
      info.projectPath = path.resolve(info.projectPath);
    } else info.projectPath = undefined;
    const recreate = existing && (existing.info.type !== info.type || existing.info.scriptPath !== info.scriptPath || existing.info.projectPath !== info.projectPath);
    if (recreate && config.confirmed !== true) throw new Error("Changing source/type recreates the folder and stops its owned sessions; confirmed=true is required");
    const apply = async () => {
      let prepared: { items: FolderItem[]; capabilities: FolderCapabilities } | undefined;
      let runner: FolderRunner | undefined;
      try {
        if (info.type === "scripted") {
          runner = new FolderRunner(info.scriptPath!, this.timeoutMs);
          prepared = await this.readScript(info, runner);
        } else if (info.type === "my_wins") prepared = { items: this.readMywins(info), capabilities: { ...editable } };
      } catch (error) { runner?.dispose(); throw error; }
      if (this.disposed) { runner?.dispose(); throw new Error("Folder service stopped"); }
      if (existing) this.stopState(existing);
      if (recreate) {
        this.manager.closeProject(existing.info.name);
        info.id = crypto.randomUUID();
      }
      const state: State = existing ?? { info, queue: Promise.resolve() };
      state.info = info;
      state.runner = runner;
      this.states.set(info.name.toLowerCase(), state);
      if (prepared) {
        info.capabilities = prepared.capabilities;
        this.manager.reconcileFolder(info, prepared.items, info.capabilities);
        info.lastListedAt = new Date().toISOString();
      }
      delete info.confirmed;
      info.error = undefined;
      this.persist(state);
      this.schedule(state);
      return info;
    };
    return existing ? this.locked(existing, apply) : apply();
  }

  async listFolder(project: string, reloadScript = false): Promise<ConsoleRecord[]> {
    const state = this.require(project);
    return this.locked(state, async () => {
      if (reloadScript && state.info.type === "scripted") { state.runner?.dispose(); state.runner = undefined; }
      return this.applyList(state);
    });
  }

  async entry(project: string, id?: string): Promise<{ folder: FolderInfo; fields: FolderField[]; values: Record<string, string> }> {
    const state = this.require(project);
    return this.locked(state, async () => {
      const record = id ? this.record(id) : undefined;
      if (record && record.project.toLowerCase() !== state.info.name.toLowerCase()) throw new Error("Console belongs to another folder");
      let fields: FolderField[];
      if (state.info.type === "scripted") {
        const result = await this.runner(state).call<FolderField[] | null>("defineFields", this.context(state.info));
        state.info.capabilities = result.capabilities;
        fields = this.validateFields(result.result ?? defaultFolderFields);
      } else fields = state.info.type === "manual" ? manualFields : mywinsFields;
      const values = record ? { ...record.sourceValues, name: record.name, description: record.description ?? "", cwd: record.cwd,
        background: record.background ?? "", command: record.command, ...record.sourceValues } :
        Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ""]));
      return { folder: state.info, fields, values };
    });
  }

  async createEntry(project: string, values: Record<string, string>): Promise<ConsoleRecord[]> {
    const state = this.require(project);
    return this.locked(state, async () => {
      await this.validateValues(state, values);
      if (!state.info.capabilities.create) throw new Error("Folder does not support create");
      if (state.info.type === "scripted") await this.runner(state).call("create", this.context(state.info), values);
      else if (state.info.type === "my_wins") this.manager.addMywinsEntry(state.info.name, this.mywinsValues(values));
      else this.manager.registerConsole({ project: state.info.name, name: values.name, description: values.description, command: values.command, cwd: values.cwd || undefined, background: values.background, persistent: true });
      return this.applyList(state);
    });
  }

  async updateEntry(id: string, values: Record<string, string>): Promise<ConsoleRecord[]> {
    const record = this.record(id);
    if (record.readonly || record.orphaned) throw new Error("Console source is readonly or orphaned");
    const state = this.require(record.project);
    return this.locked(state, async () => {
      await this.validateValues(state, values);
      if (!state.info.capabilities.update) throw new Error("Folder does not support update");
      let remap: { id: string; key: string } | undefined;
      if (state.info.type === "scripted") {
        const result = await this.runner(state).call<{ key?: string } | undefined>("update", this.context(state.info), this.original(record), values);
        if (result.result?.key) remap = { id, key: result.result.key };
      } else if (state.info.type === "my_wins") {
        this.manager.updateMywinsEntry(id, this.mywinsValues(values));
        remap = { id, key: values.name };
      }
      else this.manager.updateManual(id, values);
      return this.applyList(state, remap);
    });
  }

  async renameEntry(id: string, name: string): Promise<ConsoleRecord> {
    const record = this.record(id);
    const form = await this.entry(record.project, id);
    await this.updateEntry(id, { ...form.values, name });
    return this.record(id);
  }

  async deleteEntry(id: string, confirmed: boolean): Promise<void> {
    if (!confirmed) throw new Error("Deletion changes the source and stops the owned session; confirmed=true is required");
    const record = this.record(id);
    if (record.readonly) throw new Error("Console is readonly");
    const state = this.require(record.project);
    return this.locked(state, async () => {
      if (!state.info.capabilities.delete) throw new Error("Folder does not support delete");
      if (state.info.type === "scripted") await this.runner(state).call("delete", this.context(state.info), this.original(record));
      else if (state.info.type === "my_wins") this.manager.deleteMywinsEntry(id);
      if (this.manager.list().some((item) => item.id === id)) this.manager.removeSlot(id);
      await this.applyList(state);
    });
  }

  async readOutput(id: string, tailLines?: number): Promise<string> {
    const record = this.record(id);
    if (!record.readonly) return this.manager.readOutput(id, tailLines);
    const state = this.require(record.project);
    return this.locked(state, async () => {
      const result = await this.runner(state).call<string>("readOutput", this.context(state.info), this.original(record), { tailLines: tailLines ?? 300 });
      if (typeof result.result !== "string") throw new Error("readOutput must return a string");
      return result.result;
    });
  }

  async snapshot(id: string) {
    const record = this.record(id);
    if (!record.readonly) return this.manager.get(id);
    return { ...record, outputTail: await this.readOutput(id), cards: [], errorMatches: [] };
  }

  async sessionState(id: string, tailLines = 8) {
    const record = this.record(id);
    if (!record.readonly) return this.manager.getState(id, tailLines);
    const tail = await this.readOutput(id, tailLines);
    return { ...record, tail, tailLines: tail.split(/\r?\n/).filter((line, index, all) => line || index < all.length - 1) };
  }

  close(project: string): void {
    const state = this.require(project);
    this.stopState(state);
    this.states.delete(state.info.name.toLowerCase());
    this.manager.closeProject(state.info.name);
    this.store.removeManagedProject(state.info.name);
  }

  async ensureManual(project: string): Promise<void> {
    const state = this.states.get(project.toLowerCase());
    if (!state) { await this.configure({ name: project, type: "manual" }); return; }
    if (state.info.type !== "manual") throw new Error("Use create_folder_entry for source-controlled folders");
    this.persist(state);
  }

  setGatherErrors(project: string, enabled: boolean): void {
    const state = this.require(project);
    this.manager.setProjectGatherErrors(state.info.name, enabled);
    state.info.gatherErrors = enabled;
    this.persist(state);
  }

  dispose(): void { this.disposed = true; for (const state of this.states.values()) this.stopState(state); }

  private addState(info: FolderInfo): void {
    const state: State = { info, queue: Promise.resolve() };
    this.states.set(info.name.toLowerCase(), state);
    this.manager.setFolderState(info);
  }

  private require(project: string): State {
    let state = this.states.get(project.toLowerCase()) ?? [...this.states.values()].find((item) => item.info.id === project);
    if (!state) {
      const legacy = this.manager.listProjects().find((item) => item.name.toLowerCase() === project.toLowerCase());
      if (legacy) {
        this.addState({ id: crypto.randomUUID(), name: legacy.name, type: legacy.projectPath ? "my_wins" : "manual", projectPath: legacy.projectPath, gatherErrors: legacy.gatherErrors, intervalSeconds: 60, capabilities: { ...editable } });
        state = this.states.get(legacy.name.toLowerCase());
      }
    }
    if (!state) throw new Error(`Folder ${project} not found`);
    return state;
  }

  private record(id: string): ConsoleRecord {
    const record = this.manager.list().find((item) => item.id === id);
    if (!record) throw new Error(`Console ${id} not found`);
    return record;
  }

  private locked<T>(state: State, operation: () => Promise<T>): Promise<T> {
    const next = state.queue.catch(() => undefined).then(() => {
      if (this.disposed || ![...this.states.values()].includes(state)) throw new Error("Folder is closed");
      return operation();
    });
    state.queue = next.catch(() => undefined);
    return next;
  }

  private runner(state: State): FolderRunner {
    return state.runner ??= new FolderRunner(state.info.scriptPath!, this.timeoutMs);
  }

  private context(info: FolderInfo) { return { folder: { id: info.id, name: info.name }, dataDir: this.manager.getSettings().dataDir }; }
  private original(record: ConsoleRecord) { return { ...record.sourceValues, key: record.sourceKey ?? record.name, name: record.name }; }

  private async applyList(state: State, remap?: { id: string; key: string }): Promise<ConsoleRecord[]> {
    try {
      if (state.info.type === "manual") { this.persist(state); return this.manager.list(state.info.name); }
      const prepared = state.info.type === "scripted" ? await this.readScript(state.info, this.runner(state)) : { items: this.readMywins(state.info), capabilities: { ...editable } };
      if (this.disposed || ![...this.states.values()].includes(state)) throw new Error("Folder is closed");
      const rows = this.manager.reconcileFolder(state.info, prepared.items, prepared.capabilities, remap);
      state.info.capabilities = prepared.capabilities;
      state.info.lastListedAt = new Date().toISOString();
      state.info.error = undefined;
      this.persist(state);
      return rows;
    } catch (error) {
      state.info.error = error instanceof Error ? error.message : String(error);
      this.manager.setFolderState(state.info);
      throw error;
    } finally { this.schedule(state); }
  }

  private async readScript(info: FolderInfo, runner: FolderRunner) {
    const result = await runner.call<unknown>("list", this.context(info));
    return { items: this.validateItems(result.result, result.capabilities), capabilities: result.capabilities };
  }

  private readMywins(info: FolderInfo): FolderItem[] {
    const directory = info.projectPath!;
    const file = ["mywins.json", "my_wins.json"].map((name) => path.join(directory, name)).find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error(`No mywins.json or my_wins.json found in ${directory}`);
    const document = JSON5.parse(fs.readFileSync(file, "utf8")) as { wins?: Record<string, BatchWinConfig> };
    return this.validateItems(Object.entries(document.wins ?? {}).map(([name, config]) => ({
      key: name, name, command: config.cmd ?? config.command ?? "", cwd: config.cwd ? path.resolve(directory, config.cwd) : directory,
      noRun: config.no_run === true, ansiParserEnabled: config.ansiParserEnabled, background: config.background ?? config.backgroung,
      values: { name, command: config.cmd ?? config.command ?? "", cwd: config.cwd ?? "", background: config.background ?? config.backgroung ?? "", no_run: String(config.no_run === true), ansiParserEnabled: String(config.ansiParserEnabled !== false) }
    })), editable);
  }

  private validateItems(value: unknown, capabilities: FolderCapabilities): FolderItem[] {
    if (!Array.isArray(value) || value.length > 10000) throw new Error("list must return an array of at most 10000 entries");
    const keys = new Set<string>();
    const names = new Set<string>();
    for (const item of value as FolderItem[]) {
      if (!item || typeof item.key !== "string" || !item.key || typeof item.name !== "string" || !item.name.trim()) throw new Error("Each folder entry needs string key and name");
      if (keys.has(item.key) || names.has(item.name)) throw new Error("Duplicate folder entry key or name");
      keys.add(item.key); names.add(item.name);
      for (const field of ["command", "cwd", "shell", "description", "background"] as const) if (item[field] !== undefined && typeof item[field] !== "string") throw new Error(`Invalid entry ${field}`);
      if (item.args !== undefined && (!Array.isArray(item.args) || item.args.some((arg) => typeof arg !== "string"))) throw new Error("Invalid entry args");
      if (item.values !== undefined && (!item.values || typeof item.values !== "object" || Array.isArray(item.values) || Object.values(item.values).some((field) => typeof field !== "string"))) throw new Error("Entry values must be strings");
      if (item.background && !resolveConsoleBackground(item.background)) throw new Error("Invalid background color");
      if (item.readonly && !capabilities.readOutput) throw new Error("Readonly entries require readOutput");
      if (item.external && !item.readonly) throw new Error("External status is allowed only for readonly entries");
      if (item.external?.status && !["idle", "running", "exited"].includes(item.external.status)) throw new Error("Invalid external status");
      if (item.external?.pid !== undefined && (!Number.isInteger(item.external.pid) || item.external.pid < 0)) throw new Error("Invalid external pid");
    }
    return value;
  }

  private validateFields(value: FolderField[]): FolderField[] {
    if (!Array.isArray(value) || value.length > 64) throw new Error("defineFields must return at most 64 fields");
    const names = new Set<string>();
    for (const field of value) {
      if (!field || !/^[a-zA-Z_][\w-]*$/.test(field.name) || ["__proto__", "constructor", "prototype"].includes(field.name) || names.has(field.name) || !["string", "color"].includes(field.type) || typeof field.label !== "string") throw new Error("Invalid defineFields schema");
      names.add(field.name);
    }
    return value;
  }

  private async validateValues(state: State, values: Record<string, string>): Promise<void> {
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.values(values).some((value) => typeof value !== "string")) throw new Error("Field values must be strings");
    const fields = state.info.type === "scripted" ? await this.runner(state).call<FolderField[] | null>("defineFields", this.context(state.info)).then((result) => {
      state.info.capabilities = result.capabilities;
      return this.validateFields(result.result ?? defaultFolderFields);
    }) : state.info.type === "manual" ? manualFields : mywinsFields;
    for (const field of fields) {
      if (field.required && !values[field.name]?.trim()) throw new Error(`${field.label} is required`);
      if (field.type === "color" && values[field.name] && !resolveConsoleBackground(values[field.name])) throw new Error(`${field.label}: invalid color`);
    }
  }

  private mywinsValues(values: Record<string, string>): MywinsEntry {
    for (const field of ["no_run", "ansiParserEnabled"]) if (values[field] && !["true", "false"].includes(values[field])) throw new Error(`${field} must be true or false`);
    return { name: values.name, command: values.command, cwd: values.cwd, background: values.background, no_run: values.no_run === "true", ansiParserEnabled: values.ansiParserEnabled !== "false" };
  }

  private persist(state: State): void {
    const { capabilities: _capabilities, lastListedAt: _lastListed, error: _error, confirmed: _confirmed, ...config } = state.info;
    const old = this.store.listManagedProjects().find((item) => item.id === config.id);
    const project: ManagedProject = { ...config, createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.store.saveProject(project);
    this.manager.setFolderState(state.info);
  }

  private schedule(state: State): void {
    if (state.timer) clearTimeout(state.timer);
    if (this.disposed || ![...this.states.values()].includes(state) || state.info.type === "manual" || !state.info.intervalSeconds) return;
    state.timer = setTimeout(() => { void this.listFolder(state.info.id).catch(() => undefined); }, Math.max(250, state.info.intervalSeconds * 1000));
    state.timer.unref();
  }

  private stopState(state: State): void { if (state.timer) clearTimeout(state.timer); state.runner?.dispose(); state.runner = undefined; }
}
