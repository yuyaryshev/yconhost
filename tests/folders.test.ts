import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/api.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { ConsoleStore } from "../src/server/consoleStore.js";
import { FolderService } from "../src/server/folderService.js";
import { FolderRunner } from "../src/server/folderRunner.js";
import { migrateBuiltinFolders } from "../src/server/folderMigration.js";
import { LogStore } from "../src/server/logStore.js";
import { ProjectStore } from "../src/server/projectStore.js";
import { loadSettings } from "../src/server/settings.js";
import { FakeTerminalFactory } from "../src/server/terminal.js";
import { colorHex, resolveConsoleBackground, standardColors } from "../src/shared/colors.js";
import { configureCodexFixture } from "./folderFixtures.js";

describe("Generic folders", () => {
  let dir: string;
  let settings: ReturnType<typeof loadSettings>;
  let factory: FakeTerminalFactory;
  let manager: ConsoleManager;
  let folders: FolderService;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-folders-"));
    settings = { ...loadSettings(path.join(dir, "absent.json5")), dataDir: dir, codexContexts: {
      projectName: "agents", contextsPath: path.join(dir, "contexts.md"), weztermPresetsPath: path.join(dir, "missing.lua")
    } };
    factory = new FakeTerminalFactory();
    manager = new ConsoleManager(settings, new LogStore(settings), factory, new ConsoleStore(settings), new ProjectStore(settings));
    folders = new FolderService(manager, 500);
    app = createApp(manager, { folders });
  });
  afterEach(() => { folders.dispose(); manager.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });

  async function source(name = "custom", code?: string) {
    const scriptPath = path.join(dir, `${name}.mjs`);
    const dataFile = path.join(dir, `${name}.json`);
    fs.writeFileSync(dataFile, JSON.stringify([{ key: "one", name: "One", command: "echo first", values: { name: "One", description: "original" } }]));
    fs.writeFileSync(scriptPath, code ?? `
      import fs from 'node:fs';
      const file = ${JSON.stringify(dataFile)};
      export function list() { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      function save(items) { fs.writeFileSync(file, JSON.stringify(items)); }
      export function create(_context, values) { save([...list(), { key: values.name, name: values.name, values }]); }
      export function update(_context, original, values) { save(list().map(item => item.key === original.key ? { ...item, key: values.name, name: values.name, values } : item)); return { key: values.name }; }
      function remove(_context, original) { save(list().filter(item => item.key !== original.key)); }
      export { remove as delete };
    `);
    await folders.configure({ name, type: "scripted", scriptPath, intervalSeconds: 0 });
    return { scriptPath, dataFile };
  }

  it("uses independent JS files, retains slots and defaults to name/description without defineFields", async () => {
    const one = await source();
    await source("other");
    const id = manager.list("custom")[0].id;
    expect(factory.sessions).toHaveLength(0);
    expect(manager.list("custom")[0].gatherErrors).toBe(true);
    const form = await folders.entry("custom", id);
    expect(form.fields.map((field) => field.name)).toEqual(["name", "description"]);
    await folders.listFolder("custom", true);
    expect(manager.list("custom")[0].id).toBe(id);
    await expect(folders.configure({ name: "duplicate", type: "scripted", scriptPath: one.scriptPath })).rejects.toThrow("One folder per JS");
    await folders.createEntry("custom", { name: "Two", description: "new" });
    expect(manager.list("custom").map((item) => item.name)).toEqual(["One", "Two"]);
    expect(manager.list("other")).toHaveLength(1);
  });

  it("updates source keys without losing console identity, log, read marks or process", async () => {
    await source();
    const record = manager.list("custom")[0];
    manager.start(record.id);
    factory.sessions[0].push("Error: keep this history\r\n");
    manager.resize(record.id, 160, 40);
    manager.markRead(record.id);
    const before = manager.get(record.id);
    await folders.updateEntry(record.id, { name: "Renamed", description: "edited" });
    expect(manager.get(record.id)).toMatchObject({ name: "Renamed", sourceKey: "Renamed", pid: before.pid, readCardHashes: before.readCardHashes });
    expect(manager.readOutput(record.id)).toContain("keep this history");
    expect(factory.sessions).toHaveLength(1);
    await folders.listFolder("custom");
    expect(manager.list("custom")).toHaveLength(1);
  });

  it("marks running missing entries orphaned, removes idle entries, and reattaches without duplicates", async () => {
    const { dataFile } = await source();
    await folders.createEntry("custom", { name: "Idle", description: "" });
    const record = manager.list("custom")[0];
    manager.start(record.id);
    const saved = fs.readFileSync(dataFile, "utf8");
    fs.writeFileSync(dataFile, "[]");
    await folders.listFolder("custom");
    expect(manager.list("custom")).toEqual([expect.objectContaining({ id: record.id, orphaned: true })]);
    expect(factory.sessions[0].killed).toBe(false);
    fs.writeFileSync(dataFile, saved);
    await folders.listFolder("custom");
    expect(manager.list("custom")[0]).toMatchObject({ id: record.id, orphaned: false });
  });

  it("retains the last good composition on invalid output, errors and worker timeouts", async () => {
    const { scriptPath, dataFile } = await source();
    const before = manager.list("custom")[0].id;
    fs.writeFileSync(dataFile, JSON.stringify([{ key: "duplicate", name: "A" }, { key: "duplicate", name: "B" }]));
    await expect(folders.listFolder("custom")).rejects.toThrow("Duplicate");
    expect(manager.list("custom")[0].id).toBe(before);
    expect(folders.get("custom").error).toContain("Duplicate");
    expect(folders.get("custom").error).toContain('"duplicate"');
    expect(folders.get("custom").error).toContain('"A" and "B"');
    const projects = await request(app).get("/api/projects").expect(200);
    expect(projects.body.projects.find((project: { name: string }) => project.name === "custom").error).toContain('"duplicate"');
    fs.writeFileSync(dataFile, JSON.stringify([{ key: "a", name: "Same" }, { key: "b", name: "Same" }]));
    await expect(folders.listFolder("custom")).rejects.toThrow('Duplicate folder entry name "Same"');
    fs.writeFileSync(scriptPath, "export function list() { while (true) {} }");
    await expect(folders.listFolder("custom", true)).rejects.toThrow("timed out");
    expect(manager.list("custom")[0].id).toBe(before);
    await request(app).get("/api/health").expect(200);
    fs.writeFileSync(scriptPath, "export function list() { return []; }");
    await folders.listFolder("custom", true);
    expect(manager.list("custom")).toEqual([]);
    expect(folders.get("custom").error).toBeUndefined();
    fs.writeFileSync(scriptPath, "export function list() { return []; } export function defineFields() { return [{ name: 'background', label: 'Color', type: 'color', defaultValue: 42 }]; }");
    await folders.listFolder("custom", true);
    await expect(folders.entry("custom")).rejects.toThrow("Invalid defineFields");
  });

  it("requires confirmation for recreation, validates before stopping, and keeps source files/logs", async () => {
    const { dataFile, scriptPath } = await source();
    const record = manager.list("custom")[0];
    manager.start(record.id);
    factory.sessions[0].push("archive\r\n");
    await expect(folders.configure({ name: "custom", type: "manual" })).rejects.toThrow("confirmed=true");
    const broken = path.join(dir, "broken.mjs");
    fs.writeFileSync(broken, "throw new Error('cannot load')");
    await expect(folders.configure({ name: "custom", type: "scripted", scriptPath: broken, confirmed: true })).rejects.toThrow("cannot load");
    expect(factory.sessions[0].killed).toBe(false);
    fs.writeFileSync(scriptPath, "export function list() { return [{ key: 'one', name: 'One', readonly: true }]; } export function readOutput() { return ''; }");
    await expect(folders.configure({ name: "custom", type: "scripted", scriptPath })).rejects.toThrow("Stop the owned console");
    expect(folders.get("custom").capabilities.create).toBe(true);
    expect(manager.get(record.id).readonly).not.toBe(true);
    await folders.configure({ name: "custom", type: "manual", confirmed: true });
    expect(factory.sessions[0].killed).toBe(true);
    expect(manager.list("custom")).toEqual([]);
    expect(fs.existsSync(dataFile)).toBe(true);
    expect(new LogStore(settings).read(record.id)).toContain("archive");
  });

  it("keeps pendingRestart across repeated lists and clears it only after explicit restart", async () => {
    const { dataFile } = await source();
    const record = manager.list("custom")[0];
    manager.start(record.id);
    const values = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    values[0].command = "echo changed";
    fs.writeFileSync(dataFile, JSON.stringify(values));
    await folders.listFolder("custom");
    await folders.listFolder("custom");
    expect(manager.get(record.id).pendingRestart).toBe(true);
    expect(factory.sessions).toHaveLength(1);
    manager.restart(record.id);
    expect(manager.get(record.id).pendingRestart).not.toBe(true);
    expect(factory.sessions).toHaveLength(2);
  });

  it("provides generic external readonly status/output without owning or starting a process", async () => {
    await source("monitor", `export function list() { return [{ key: 'external', name: 'Service', readonly: true, values: {}, external: { pid: 1234, status: 'running', lastOutputAt: '2026-11-01T12:00:00Z' } }]; } export function readOutput() { return 'first\\nlast\\n'; }`);
    const record = manager.list("monitor")[0];
    expect(record).toMatchObject({ readonly: true, source: "external", pid: 1234 });
    expect((await folders.sessionState(record.id)).tail).toContain("last");
    expect((await folders.snapshot(record.id)).outputTail).toContain("first");
    expect(factory.sessions).toHaveLength(0);
    await request(app).post(`/api/consoles/${record.id}/start`).expect(400);
    await request(app).post(`/api/consoles/${record.id}/input`).send({ data: "x" }).expect(400);
    await expect(folders.createEntry("monitor", { name: "bad" })).rejects.toThrow("does not support create");
    folders.close("monitor");
    expect(factory.sessions).toHaveLength(0);
  });

  it("exposes folder CRUD and capability errors through HTTP and MCP, without legacy import", async () => {
    await source();
    const call = (name: string, args: object) => request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }).expect(200);
    const fields = await call("get_folder_fields", { project: "custom" });
    expect(JSON.parse(fields.body.result.content[0].text).fields).toHaveLength(2);
    await call("create_folder_entry", { project: "custom", values: { name: "MCP", description: "created" } });
    const id = manager.list("custom").find((item) => item.name === "MCP")!.id;
    await call("update_folder_entry", { id, values: { name: "Updated", description: "edited" } });
    expect(manager.get(id).name).toBe("Updated");
    const refused = await call("delete_folder_entry", { id, confirmed: false });
    expect(refused.body.result.isError).toBe(true);
    await call("delete_folder_entry", { id, confirmed: true });
    expect(() => manager.get(id)).toThrow("not found");
    const legacy = await call("import_codex_contexts", {});
    expect(legacy.body.result.isError).toBe(true);
    await request(app).post("/api/consoles").send({ project: "custom" }).expect(400);
    await request(app).get("/api/projects/custom/settings").expect(200);
  });

  it("rejects stale form revisions even after a periodic list has adopted the external edit", async () => {
    const { dataFile } = await source();
    const record = manager.list("custom")[0];
    const form = await folders.entry("custom", record.id);
    const entries = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    entries[0].values.description = "external edit";
    fs.writeFileSync(dataFile, JSON.stringify(entries));
    await folders.listFolder("custom");
    await expect(folders.updateEntry(record.id, { ...form.values, name: "stale rename" }, form.revision)).rejects.toThrow("externally");
    expect(JSON.parse(fs.readFileSync(dataFile, "utf8"))[0].values.description).toBe("external edit");
  });

  it("serializes folder registration and does not leak duplicate instances", async () => {
    await Promise.all([folders.configure({ name: "Shared", type: "manual" }), folders.configure({ name: "Shared", type: "manual" })]);
    expect(folders.list().filter((folder) => folder.name === "Shared")).toHaveLength(1);
    expect(folders.store.listManagedProjects().filter((folder) => folder.name === "Shared")).toHaveLength(1);
  });

  it("renames a manual shell without rewriting its arguments or marking restart pending", async () => {
    const record = manager.create({ name: "Shell", shell: "cmd.exe", args: [] });
    await folders.renameEntry(record.id, "Renamed shell");
    expect(manager.get(record.id)).toMatchObject({ name: "Renamed shell", args: [], pendingRestart: false });
    manager.restart(record.id);
    expect(manager.get(record.id).args).toEqual([]);
  });

  it("preserves mywins identity/history on rename and supports adding to an empty configured folder", async () => {
    const projectPath = path.join(dir, "wins");
    fs.mkdirSync(projectPath);
    const file = path.join(projectPath, "mywins.json");
    fs.writeFileSync(file, '{"unrelated":42,"wins":{}}');
    await folders.configure({ name: "Named wins", type: "my_wins", projectPath, intervalSeconds: 0 });
    await folders.createEntry("Named wins", { name: "Before", command: "echo old", cwd: "", no_run: "false", background: "STD_GREEN" });
    const record = manager.list("Named wins")[0];
    manager.start(record.id);
    factory.sessions[0].push("retain this log\r\n");
    const form = await folders.entry("Named wins", record.id);
    await folders.updateEntry(record.id, { ...form.values, name: "After", command: "echo new" }, form.revision);
    expect(manager.get(record.id)).toMatchObject({ name: "After", pendingRestart: true, project: "Named wins" });
    expect(manager.readOutput(record.id)).toContain("retain this log");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ unrelated: 42, wins: { After: { cmd: "echo new" } } });
    expect(factory.sessions).toHaveLength(1);
  });

  it("warns and refuses MCP file changes without explicit source-write confirmation", async () => {
    const projectPath = path.join(dir, "file-backed");
    fs.mkdirSync(projectPath);
    const file = path.join(projectPath, "my_wins.json");
    fs.writeFileSync(file, JSON.stringify({ wins: { Build: { cmd: "echo build" } } }));
    await folders.configure({ name: "Builds", type: "my_wins", projectPath, intervalSeconds: 0 });
    const record = manager.list("Builds")[0];
    const form = await folders.entry("Builds", record.id);
    const before = fs.readFileSync(file, "utf8");
    const call = (name: string, args: object) => request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }).expect(200);
    for (const [name, args] of [
      ["create_console", { project: "Builds", name: "Temp" }],
      ["register_console", { project: "Builds", name: "Temp" }],
      ["create_folder_entry", { project: "Builds", values: { name: "Temp" } }],
      ["update_folder_entry", { id: record.id, values: { ...form.values, command: "echo changed" } }],
      ["delete_folder_entry", { id: record.id, confirmed: true }]
    ] as const) {
      const refused = await call(name, args);
      expect(refused.body.result.isError).toBe(true);
      const warning = refused.body.result.content[0].text;
      expect(warning).toContain("WARNING");
      expect(warning).toContain(file);
      expect(warning).toContain("editing this file directly");
      expect(warning).toContain("separate manual project");
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    }
    const schema = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 2, method: "tools/list" }).expect(200);
    for (const name of ["create_folder_entry", "update_folder_entry", "delete_folder_entry"]) {
      const tool = schema.body.result.tools.find((item: { name: string }) => item.name === name);
      expect(tool.description).toContain("prefer editing the file directly");
      expect(tool.inputSchema.properties.confirmSourceWrite.type).toBe("boolean");
    }
    const fields = await call("get_folder_fields", { project: "Builds", id: record.id });
    expect(JSON.parse(fields.body.result.content[0].text).sourceWriteWarning).toContain(file);
    const invalid = await call("create_folder_entry", { project: "Builds", values: { name: "Temp" }, confirmSourceWrite: "true" });
    expect(invalid.body.result.isError).toBe(true);
    const created = await call("create_folder_entry", { project: "Builds", values: { name: "Added", command: "echo added" }, confirmSourceWrite: true });
    expect(created.body.result.isError).not.toBe(true);
    const updated = await call("update_folder_entry", { id: record.id, values: { ...form.values, command: "echo changed" }, revision: form.revision, confirmSourceWrite: true });
    expect(updated.body.result.isError).not.toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).wins.Build.cmd).toBe("echo changed");
    const removed = await call("delete_folder_entry", { id: record.id, confirmed: true, confirmSourceWrite: true });
    expect(removed.body.result.isError).not.toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).wins.Build).toBeUndefined();
    await call("create_project", { name: "Tasks", type: "manual" });
    const temporary = await call("register_console", { project: "Tasks", name: "Temp", cwd: projectPath });
    expect(JSON.parse(temporary.body.result.content[0].text).persistent).toBe(false);
    expect(factory.sessions).toHaveLength(0);
  });

  it("migrates legacy batch folders but keeps MCP working-directory groups manual", async () => {
    const projectPath = path.join(dir, "wins");
    fs.mkdirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "my_wins.json"), JSON.stringify({ wins: { Build: { cmd: "echo build" } } }));
    const [canonical] = manager.createBatch(projectPath, undefined, { startNew: false });
    manager.registerConsole({ project: "wins", projectPath, name: "Build", command: "echo duplicate" });
    manager.registerConsole({ project: "wins", projectPath, name: "Obsolete" });
    manager.registerConsole({ project: "Context", projectPath, name: "Task" });
    manager.registerConsole({ project: "Missing", projectPath: path.join(dir, "no-source"), name: "Task" });
    folders.dispose();
    folders = new FolderService(manager);
    folders.adoptRegistry();
    await folders.initialize();
    expect(folders.get("wins").type).toBe("my_wins");
    expect(manager.list("wins")).toEqual([expect.objectContaining({ id: canonical.id, command: "echo build" })]);
    for (const name of ["Context", "Missing"]) {
      expect(folders.get(name)).toMatchObject({ type: "manual", error: undefined });
      expect(manager.list(name)).toHaveLength(1);
    }
    folders.dispose();
    folders = new FolderService(manager);
    folders.adoptRegistry();
    expect(folders.get("wins").type).toBe("my_wins");
    expect(folders.get("Context").type).toBe("manual");
    expect(factory.sessions).toHaveLength(0);
  });

  it("respects explicitly saved manual types even for legacy batch slots", async () => {
    const projectPath = path.join(dir, "manual-choice");
    fs.mkdirSync(projectPath);
    fs.writeFileSync(path.join(projectPath, "mywins.json"), JSON.stringify({ wins: { Build: {} } }));
    manager.createBatch(projectPath, undefined, { startNew: false });
    const now = new Date().toISOString();
    folders.store.saveProject({ name: "manual-choice", type: "manual", createdAt: now, updatedAt: now });
    folders.dispose();
    folders = new FolderService(manager);
    folders.adoptRegistry();
    expect(folders.get("manual-choice").type).toBe("manual");
  });

  it("serializes overlapping mutations and periodically lists without starting commands", async () => {
    const { scriptPath } = await source();
    await Promise.all([folders.createEntry("custom", { name: "A" }), folders.createEntry("custom", { name: "B" })]);
    expect(manager.list("custom")).toHaveLength(3);
    await folders.configure({ name: "custom", type: "scripted", scriptPath, intervalSeconds: 0.025 });
    const before = folders.get("custom").lastListedAt;
    await new Promise((resolve) => setTimeout(resolve, 310));
    expect(folders.get("custom").lastListedAt).not.toBe(before);
    expect(factory.sessions).toHaveLength(0);
  });

  it("restores definitions and folder settings after restart without launching processes", async () => {
    await source();
    const id = manager.list("custom")[0].id;
    folders.dispose(); manager.dispose();
    factory = new FakeTerminalFactory();
    manager = new ConsoleManager(settings, new LogStore(settings), factory, new ConsoleStore(settings), new ProjectStore(settings));
    folders = new FolderService(manager);
    await folders.initialize();
    expect(manager.list("custom")[0].id).toBe(id);
    expect(folders.get("custom").type).toBe("scripted");
    expect(factory.sessions).toHaveLength(0);
  });

  it("migrates legacy source registration once and never rewrites Markdown or re-adds a closed folder", async () => {
    fs.writeFileSync(settings.codexContexts.contextsPath, "# Saved\nColor: STD_CYAN\n```cmd\nycodex resume guid\n```\n");
    const before = fs.readFileSync(settings.codexContexts.contextsPath, "utf8");
    const legacy = manager.registerConsole({ project: "agents", name: "Saved", command: "old" });
    await migrateBuiltinFolders(folders, settings);
    folders.adoptRegistry();
    await folders.listFolder("agents");
    expect(manager.list("agents")[0]).toMatchObject({ id: legacy.id, gatherErrors: false, background: "STD_CYAN" });
    expect(fs.readFileSync(settings.codexContexts.contextsPath, "utf8")).toBe(before);
    expect(factory.sessions).toHaveLength(0);
    folders.close("agents");
    await migrateBuiltinFolders(folders, settings);
    expect(folders.store.listManagedProjects().some((folder) => folder.name === "agents")).toBe(false);
  });

  describe("Codex source", () => {
    async function agents() {
      fs.writeFileSync(settings.codexContexts.contextsPath, "preamble\n# Agent\nColor: #102030\nUnrelated: preserve\n\n```cmd\ncd /d \"D:\\work\"\nycodex resume old-guid\n```\n\n# Notes\nnot an agent\n");
      await configureCodexFixture(folders, settings);
      return manager.list("agents")[0];
    }

    it("edits name and session_id separately, rejects simultaneous changes, and preserves unrelated Markdown", async () => {
      const record = await agents();
      let form = await folders.entry("agents", record.id);
      expect(form.fields.find((field) => field.name === "background")?.type).toBe("color");
      await expect(folders.updateEntry(record.id, { ...form.values, name: "Both", session_id: "new-guid" })).rejects.toThrow("separately");
      expect(manager.get(record.id).name).toBe("Agent");
      await folders.updateEntry(record.id, { ...form.values, name: "Renamed", background: "STD_YELLOW" });
      form = await folders.entry("agents", record.id);
      await folders.updateEntry(record.id, { ...form.values, session_id: "new-guid", description: "updated" });
      expect(manager.get(record.id)).toMatchObject({ name: "Renamed", sourceKey: "new-guid", background: "STD_YELLOW", description: "updated" });
      expect(manager.get(record.id).command).toContain("resume new-guid");
      const text = fs.readFileSync(settings.codexContexts.contextsPath, "utf8");
      expect(text).toContain("Color: STD_YELLOW");
      expect(text).toContain("Unrelated: preserve");
      expect(text).toContain("# Notes\nnot an agent\n");
      expect(text.startsWith("preamble\n")).toBe(true);
    });

    it("detects external conflicts before writing, soft-deletes, restores and supports name identity without GUID", async () => {
      const record = await agents();
      const form = await folders.entry("agents", record.id);
      fs.appendFileSync(settings.codexContexts.contextsPath, "tail\n");
      // A change in a different section is safe and must survive our edit.
      await folders.updateEntry(record.id, { ...form.values, description: "safe" });
      const current = await folders.entry("agents", record.id);
      fs.writeFileSync(settings.codexContexts.contextsPath, fs.readFileSync(settings.codexContexts.contextsPath, "utf8").replace("Unrelated: preserve", "Unrelated: external edit"));
      await expect(folders.updateEntry(record.id, { ...current.values, name: "Conflict" })).rejects.toThrow("externally");
      await folders.listFolder("agents");
      await folders.deleteEntry(record.id, true);
      expect(manager.list("agents")).toEqual([]);
      expect(fs.readFileSync(settings.codexContexts.contextsPath, "utf8")).toContain("# DELETED Agent");
      fs.writeFileSync(settings.codexContexts.contextsPath, fs.readFileSync(settings.codexContexts.contextsPath, "utf8").replace("# DELETED Agent", "# Agent"));
      await folders.listFolder("agents");
      await folders.createEntry("agents", { name: "Fresh", description: "new", session_id: "", cwd: dir, background: "STD_RED" });
      const fresh = manager.list("agents").find((item) => item.name === "Fresh")!;
      const freshForm = await folders.entry("agents", fresh.id);
      await folders.updateEntry(fresh.id, { ...freshForm.values, name: "New name" });
      expect(manager.get(fresh.id)).toMatchObject({ name: "New name", sourceKey: "New name" });
      expect(factory.sessions).toHaveLength(0);
    });
  });
});

it("resolves all standard colors consistently without losing named presets", () => {
  expect(Object.keys(standardColors)).toHaveLength(8);
  expect(resolveConsoleBackground("STD_RED")).toEqual({ dark: "rgb(20, 12, 12)", light: "rgb(255, 247, 247)" });
  expect(resolveConsoleBackground("STD_GREY")).toEqual(resolveConsoleBackground("STD_WHITE"));
  expect(colorHex("STD_CYAN")).toBe("#0c1414");
  expect(resolveConsoleBackground("rgb(256, 0, 0)")).toBeUndefined();
});

it("rejects missing list entry points without leaving a running worker", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-bad-worker-"));
  const script = path.join(dir, "bad.mjs");
  fs.writeFileSync(script, "export const refresh = () => [];");
  const runner = new FolderRunner(script, 500);
  try { await expect(runner.call("list", {})).rejects.toThrow("export list"); }
  finally { runner.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});
