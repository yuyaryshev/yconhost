import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/api.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { ConsoleStore } from "../src/server/consoleStore.js";
import { LogStore } from "../src/server/logStore.js";
import { ProjectStore } from "../src/server/projectStore.js";
import { loadSettings } from "../src/server/settings.js";
import { FakeTerminalFactory } from "../src/server/terminal.js";

describe("Gather errors", () => {
  let dir: string;
  let settings: ReturnType<typeof loadSettings>;
  let factory: FakeTerminalFactory;
  let logs: LogStore;
  let manager: ConsoleManager;
  let app: ReturnType<typeof createApp>;

  function restore() {
    factory = new FakeTerminalFactory();
    logs = new LogStore(settings);
    manager = new ConsoleManager(settings, logs, factory, new ConsoleStore(settings), new ProjectStore(settings));
    app = createApp(manager, { pm2: false });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-gather-"));
    const defaults = loadSettings(path.join(dir, "missing.json5"));
    settings = { ...defaults, dataDir: dir, codexContexts: {
      projectName: "codexes", contextsPath: path.join(dir, "contexts.md"), weztermPresetsPath: path.join(dir, "missing.lua")
    } };
    restore();
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to on except in Codexes, including legacy persisted sessions and future slots", () => {
    const normal = manager.registerConsole({ project: "builds", name: "normal" });
    const codex = manager.registerConsole({ project: "codexes", name: "existing" });
    const mixedCase = manager.registerConsole({ project: "Codexes", name: "Claude" });
    expect(normal.gatherErrors).toBe(true);
    expect(codex.gatherErrors).toBe(false);
    expect(mixedCase.gatherErrors).toBe(false);
    expect(codex.gatherErrorsOverride).toBeUndefined();
    expect(manager.listProjects().find((project) => project.name === "codexes")?.gatherErrors).toBe(false);
    expect(new ConsoleStore(settings).load().find((record) => record.id === codex.id)?.gatherErrors).toBeUndefined();
    manager.dispose();
    restore();
    expect(manager.get(codex.id).gatherErrors).toBe(false);
    expect(factory.sessions).toHaveLength(0);
  });

  it("disables collection and counters, cancels pending parsing, but retains output and input", async () => {
    const record = manager.create({ project: "builds", name: "worker" });
    factory.sessions[0].push("Error: pending failure\r\n");
    const read = vi.spyOn(logs, "read");
    const response = await request(app).post(`/api/consoles/${record.id}/gather-errors`).send({ enabled: false }).expect(200);
    expect(response.body).toMatchObject({ gatherErrors: false, gatherErrorsOverride: false, errorCount: 0, unseenErrorCount: 0, status: "running" });
    const listener = vi.fn();
    const unsubscribe = manager.onOutput(listener);
    factory.sessions[0].push("Error: another failure\r\nWarning: warning\r\nInfo: message\r\n");
    manager.resize(record.id, 160, 40);
    manager.updateSettings(settings);
    read.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(read).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const snapshot = manager.get(record.id);
    expect(snapshot.cards).toEqual([]);
    expect(snapshot.errorMatches).toEqual([]);
    expect(snapshot.outputTail).toContain("another failure");
    expect(snapshot.lastOutputAt).toBeTruthy();
    manager.write(record.id, "echo still working\r");
    expect(factory.sessions[0].writes.at(-1)).toBe("echo still working\r");
    const enabled = await request(app).post(`/api/consoles/${record.id}/gather-errors`).send({ enabled: true }).expect(200);
    expect(enabled.body.unseenErrorCount).toBeGreaterThan(0);
    expect(manager.get(record.id).cards.length).toBeGreaterThan(0);
  });

  it("clears existing cards and ready status immediately without restarting the process", () => {
    const record = manager.create({ project: "builds" });
    factory.sessions[0].push("Error: existing failure\r\n");
    manager.resize(record.id, 160, 40);
    expect(manager.get(record.id).cards).toHaveLength(1);
    expect(record.status).toBe("ready");
    const pid = record.pid;
    manager.setGatherErrors(record.id, false);
    expect(manager.get(record.id)).toMatchObject({ cards: [], errorCount: 0, unseenErrorCount: 0, status: "running", pid });
    expect(factory.sessions).toHaveLength(1);
  });

  it("persists project inheritance and explicit overrides through restart, Start and reimport", async () => {
    fs.writeFileSync(settings.codexContexts.contextsPath, "# Claude\nColor: `#003200`\n```cmd\nclaude --resume saved\n```\n");
    const inherited = manager.importCodexContexts().consoles[0];
    const explicit = manager.registerConsole({ project: "codexes", name: "override" });
    manager.setGatherErrors(explicit.id, true);
    await request(app).post("/api/projects/codexes/gather-errors").send({ enabled: false }).expect(200);
    expect(explicit.gatherErrors).toBe(true);
    manager.setGatherErrors(inherited.id, true);
    manager.importCodexContexts();
    expect(inherited.gatherErrorsOverride).toBe(true);
    manager.setGatherErrors(inherited.id, null);
    expect(inherited.gatherErrors).toBe(false);
    manager.dispose();
    restore();
    expect(manager.get(explicit.id)).toMatchObject({ gatherErrors: true, gatherErrorsOverride: true });
    expect(manager.get(inherited.id).gatherErrors).toBe(false);
    expect(factory.sessions).toHaveLength(0);
    manager.start(explicit.id);
    manager.restart(explicit.id);
    expect(manager.get(explicit.id)).toMatchObject({ gatherErrors: true, gatherErrorsOverride: true });
    manager.setProjectGatherErrors("codexes", true);
    expect(manager.get(inherited.id).gatherErrors).toBe(true);
    manager.setGatherErrors(explicit.id, false);
    manager.setProjectGatherErrors("codexes", true);
    expect(manager.get(explicit.id).gatherErrors).toBe(false);
    expect(manager.registerConsole({ project: "codexes", name: "future" }).gatherErrors).toBe(true);
    manager.dispose();
    restore();
    expect(manager.listProjects().find((project) => project.name === "codexes")?.gatherErrors).toBe(true);
    expect(manager.get(inherited.id).gatherErrors).toBe(true);
    expect(manager.get(explicit.id).gatherErrors).toBe(false);
  });

  it("exposes HTTP/MCP controls, validates values and restores inheritance with null", async () => {
    const record = manager.registerConsole({ project: "builds", name: "worker" });
    await request(app).post(`/api/consoles/${record.id}/gather-errors`).send({ enabled: "false" }).expect(400);
    await request(app).post(`/api/consoles/${record.id}/gather-errors`).send({}).expect(400);
    await request(app).post("/api/projects/builds/gather-errors").send({ enabled: null }).expect(400);
    const tools = await request(app).post("/mcp").send({ method: "tools/list" }).expect(200);
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["set_console_gather_errors", "set_project_gather_errors"]));
    const call = (name: string, args: object) => request(app).post("/mcp").send({ method: "tools/call", params: { name, arguments: args } }).expect(200);
    await call("set_project_gather_errors", { project: "builds", enabled: false });
    expect(record.gatherErrors).toBe(false);
    await call("set_console_gather_errors", { id: record.id, enabled: true });
    expect(record.gatherErrors).toBe(true);
    await call("set_console_gather_errors", { id: record.id, enabled: null });
    expect(record.gatherErrors).toBe(false);
    expect(record.gatherErrorsOverride).toBeUndefined();
  });
});
