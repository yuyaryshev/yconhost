import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/api.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { ConsoleStore } from "../src/server/consoleStore.js";
import { LogStore } from "../src/server/logStore.js";
import { ProjectStore } from "../src/server/projectStore.js";
import { buildTerminalEnv, FakeTerminalFactory } from "../src/server/terminal.js";
import type { AppSettings } from "../src/server/types.js";

function testSettings(dataDir: string): AppSettings {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    defaultShell: "powershell.exe",
    terminal: {
      cols: 160,
      rows: 40,
      scrollback: 0
    },
    log: {
      maxBytes: 1024 * 1024,
      rotateFiles: 2,
      scrollbackBytes: 4096
    },
    cards: {
      maxPerConsole: 500,
      scanTailBytes: 1024 * 1024
    },
    codexContexts: {
      projectName: "codexes",
      contextsPath: path.join(dataDir, "Codex contexts.md"),
      weztermPresetsPath: path.join(dataDir, "yy_wezterm_codexes.lua")
    }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("HTTP API", () => {
  let dir: string;
  let factory: FakeTerminalFactory;
  let manager: ConsoleManager;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-"));
    factory = new FakeTerminalFactory();
    manager = new ConsoleManager(testSettings(dir), new LogStore(testSettings(dir)), factory);
    app = createApp(manager, { pm2: false });
  });

  it("reports health", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body.ok).toBe(true);
  });

  it("builds a color-capable terminal environment", () => {
    const env = buildTerminalEnv({ NO_COLOR: "1" });
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.FORCE_COLOR).toBe("1");
    expect(env.CLICOLOR_FORCE).toBe("1");
    expect(env.NO_COLOR).toBeUndefined();
  });

  it("creates, lists, reads, writes and deletes a console", async () => {
    const created = await request(app).post("/api/consoles").send({ name: "dev", command: "echo ok", project: "Default", cwd: dir }).expect(200);
    expect(created.body.name).toBe("dev");

    factory.sessions[0].push("hello\r\n");
    factory.sessions[0].push("\x1b[31merror happened\x1b[0m\r\n");
    factory.sessions[0].push("still running\r\n");
    await new Promise((resolve) => setTimeout(resolve, 600));

    const list = await request(app).get("/api/consoles").expect(200);
    expect(list.body.consoles).toHaveLength(1);
    expect(list.body.consoles[0].unseenErrorCount).toBe(1);

    const snapshot = await request(app).get(`/api/consoles/${created.body.id}`).expect(200);
    expect(snapshot.body.outputTail).toContain("hello");
    expect(snapshot.body.unseenErrorCount).toBe(1);
    expect(snapshot.body.errorMatches.map((item: { line: string }) => item.line)).toContain("error happened");

    const afterView = await request(app).get("/api/consoles").expect(200);
    expect(afterView.body.consoles[0].unseenErrorCount).toBe(1);

    const read = await request(app).post(`/api/consoles/${created.body.id}/read`).expect(200);
    expect(read.body.unseenErrorCount).toBe(0);

    const renamed = await request(app).post(`/api/consoles/${created.body.id}/name`).send({ name: "renamed dev" }).expect(200);
    expect(renamed.body.name).toBe("renamed dev");

    const output = await request(app).get(`/api/consoles/${created.body.id}/output`).expect(200);
    expect(output.body.output).toContain("hello");

    const tail = await request(app).get(`/api/consoles/${created.body.id}/output?tailLines=2`).expect(200);
    expect(tail.body.output).toContain("error happened");

    await request(app).post(`/api/consoles/${created.body.id}/input`).send({ data: "dir\r" }).expect(200);
    expect(factory.sessions[0].writes.at(-1)).toBe("dir\r");

    const state = await request(app).get(`/api/consoles/${created.body.id}/state?tailLines=2`).expect(200);
    expect(state.body.lastInputAt).toBeTruthy();
    expect(state.body.lastOutputAt).toBeTruthy();
    expect(state.body.tail).toContain("still running");
    expect(state.body.tailLines).toEqual(expect.arrayContaining([expect.stringContaining("still running")]));

    await request(app).delete(`/api/consoles/${created.body.id}`).expect(200);
    await request(app).get(`/api/consoles/${created.body.id}`).expect(404);
  });

  it("creates consoles from my_wins.json in order and keeps no_run entries idle", async () => {
    fs.writeFileSync(
      path.join(dir, "my_wins.json"),
      JSON.stringify({ wins: { watch: { cmd: "npm run watch" }, disabled: { cmd: "npm test", no_run: true } } }),
      "utf8"
    );

    const response = await request(app).post("/api/batch").send({ projectPath: dir }).expect(200);
    expect(response.body.map((item: { name: string }) => item.name)).toEqual(["watch", "disabled"]);
    expect(response.body[0]).toMatchObject({ name: "watch", status: "running" });
    expect(response.body[1]).toMatchObject({ name: "disabled", status: "idle", noRun: true });
    expect(factory.sessions).toHaveLength(1);

    await request(app).post(`/api/projects/${path.basename(dir)}/restart-except-no-run`).expect(200);
    expect(factory.sessions).toHaveLength(2);
    const afterRestart = manager.list(path.basename(dir));
    expect(afterRestart.find((item) => item.name === "watch")?.status).toBe("running");
    expect(afterRestart.find((item) => item.name === "disabled")).toMatchObject({ status: "idle", noRun: true });

    await request(app).delete(`/api/consoles/${response.body[0].id}`).expect(200);
    expect(manager.get(response.body[0].id).status).toBe("idle");

    const projects = await request(app).get("/api/projects").expect(200);
    expect(projects.body.projects).toContainEqual(
      expect.objectContaining({
        name: path.basename(dir),
        consoleCount: 2
      })
    );
  });

  it("tracks recent projects, prevents duplicate opens and supports project actions", async () => {
    fs.writeFileSync(path.join(dir, "my_wins.json"), JSON.stringify({ wins: { one: { cmd: "npm run one" }, two: { cmd: "npm run two" } } }), "utf8");
    const settings = testSettings(dir);
    const projectManager = new ConsoleManager(settings, new LogStore(settings), factory, undefined, new ProjectStore(settings));
    const projectApp = createApp(projectManager, { pm2: false });

    const opened = await request(projectApp).post("/api/batch").send({ projectPath: dir }).expect(200);
    expect(opened.body).toHaveLength(2);
    expect(factory.sessions).toHaveLength(2);

    const duplicate = await request(projectApp).post("/api/batch").send({ projectPath: dir }).expect(200);
    expect(duplicate.body).toHaveLength(2);
    expect(factory.sessions).toHaveLength(2);

    const recent = await request(projectApp).get("/api/recent-projects").expect(200);
    expect(recent.body.projects[0]).toMatchObject({ path: dir, name: path.basename(dir) });

    factory.sessions[0].push("Build error\r\n");
    await request(projectApp).post(`/api/projects/${path.basename(dir)}/read`).expect(200);
    expect(projectManager.list(path.basename(dir)).every((item) => item.unseenErrorCount === 0)).toBe(true);

    await request(projectApp).post(`/api/projects/${path.basename(dir)}/stop`).expect(200);
    expect(projectManager.list(path.basename(dir)).every((item) => item.status === "exited")).toBe(true);

    await request(projectApp).post(`/api/projects/${path.basename(dir)}/start`).expect(200);
    expect(projectManager.list(path.basename(dir)).every((item) => item.status === "running")).toBe(true);

    fs.writeFileSync(path.join(dir, "my_wins.json"), JSON.stringify({ wins: { two: { cmd: "npm run two:changed" }, three: { cmd: "npm run three", no_run: true } } }), "utf8");
    const reloaded = await request(projectApp).post(`/api/projects/${path.basename(dir)}/reload`).expect(200);
    expect(reloaded.body.map((item: { name: string }) => item.name)).toEqual(["two", "three"]);
    expect(projectManager.list(path.basename(dir)).map((item) => item.name)).toEqual(["two", "three"]);
    expect(projectManager.list(path.basename(dir))[0]).toMatchObject({ name: "two", command: "npm run two:changed" });
    expect(projectManager.list(path.basename(dir))[1]).toMatchObject({ name: "three", status: "idle" });

    await request(projectApp).delete(`/api/projects/${path.basename(dir)}`).expect(200);
    expect(projectManager.list(path.basename(dir))).toHaveLength(0);
  });

  it("validates batch projectPath", async () => {
    await request(app).post("/api/batch").send({}).expect(400);
  });

  it("supports MCP-managed projects and registered console slots without mywins", async () => {
    const settings = testSettings(dir);
    const projectStore = new ProjectStore(settings);
    const managedFactory = new FakeTerminalFactory();
    const managedManager = new ConsoleManager(settings, new LogStore(settings), managedFactory, undefined, projectStore);
    const managedApp = createApp(managedManager, { pm2: false });

    const project = await request(managedApp).post("/api/projects").send({ name: "mcp_project" }).expect(200);
    expect(project.body).toMatchObject({ name: "mcp_project" });

    const projects = await request(managedApp).get("/api/projects").expect(200);
    expect(projects.body.projects).toContainEqual(expect.objectContaining({ name: "mcp_project", consoleCount: 0 }));

    const tools = await request(managedApp).post("/mcp").send({ method: "tools/list" }).expect(200);
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["create_project", "list_projects", "register_console"]));
    expect(tools.body.tools.find((tool: { name: string }) => tool.name === "create_project").description).toContain("does not require or write mywins.json");

    const registered = await request(managedApp)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "register_console", arguments: { project: "mcp_project", name: "slot", command: "echo slot", cwd: dir } } })
      .expect(200);
    const slot = JSON.parse(registered.body.content[0].text);
    expect(slot).toMatchObject({ project: "mcp_project", name: "slot", status: "idle", command: "echo slot" });
    expect(managedFactory.sessions).toHaveLength(0);

    const reloadedManager = new ConsoleManager(settings, new LogStore(settings), new FakeTerminalFactory(), undefined, projectStore);
    expect(reloadedManager.listProjects()).toContainEqual(expect.objectContaining({ name: "mcp_project" }));
  });

  it("imports Codex contexts as idle colored slots and starts only on explicit start", async () => {
    fs.writeFileSync(
      path.join(dir, "yy_wezterm_codexes.lua"),
      "local built_in_presets = {\n" +
        "  { id = 'stable', name = 'stable', background = '#000032', command = 'set \"YCODEX_HOME=C:\\\\Users\\\\Administrator\\\\.ycodex\" && cd /d D:\\\\work\\\\stable && ycodex --bypass-safety-y resume stable-thread --dangerously-bypass-approvals-and-sandbox' },\n" +
        "}\nreturn {}\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(dir, "Codex contexts.md"),
      "# Dynamic context\nColor: `#320000`\n\n```cmd\nset \"CODEX_HOME=C:\\Users\\Administrator\\.codex\"\ncd /d D:\\work\\dynamic && codex resume dynamic-thread --dangerously-bypass-approvals-and-sandbox\n```\n",
      "utf8"
    );
    const settings = testSettings(dir);
    const managedFactory = new FakeTerminalFactory();
    const managedManager = new ConsoleManager(settings, new LogStore(settings), managedFactory, undefined, new ProjectStore(settings));
    const managedApp = createApp(managedManager, { pm2: false });

    const imported = await request(managedApp).post("/api/codex-contexts/import").send({}).expect(200);
    expect(imported.body).toMatchObject({ project: "codexes", imported: 2 });
    expect(imported.body.consoles.map((item: { name: string }) => item.name)).toEqual(["stable", "Dynamic context"]);
    expect(imported.body.consoles[0]).toMatchObject({ status: "idle", noRun: true, background: "#000032" });
    expect(imported.body.consoles[0].autoStartOnOpen).toBeUndefined();
    expect(imported.body.consoles[1]).toMatchObject({ status: "idle", noRun: true, background: "#320000" });
    expect(imported.body.consoles[1].autoStartOnOpen).toBeUndefined();
    expect(imported.body.consoles[1].command).toContain("ycodex --bypass-safety-y resume dynamic-thread");
    expect(imported.body.consoles[1].command).not.toContain("CODEX_HOME=");
    expect(imported.body.consoles[1].command).not.toContain("YCODEX_HOME=");
    expect(managedFactory.sessions).toHaveLength(0);

    const started = await request(managedApp).post(`/api/consoles/${imported.body.consoles[0].id}/start`).send({}).expect(200);
    expect(started.body).toMatchObject({ name: "stable", status: "running" });
    expect(managedFactory.sessions).toHaveLength(1);

    const tools = await request(managedApp).post("/mcp").send({ method: "tools/list" }).expect(200);
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toContain("import_codex_contexts");

    const mcpImport = await request(managedApp)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "import_codex_contexts", arguments: { project: "codexes" } } })
      .expect(200);
    expect(JSON.parse(mcpImport.body.content[0].text)).toMatchObject({ project: "codexes", imported: 2 });
  });

  it("persists renamed console definitions across manager restart by recreating them", async () => {
    const settings = testSettings(dir);
    const store = new ConsoleStore(settings);
    const firstFactory = new FakeTerminalFactory();
    const firstManager = new ConsoleManager(settings, new LogStore(settings), firstFactory, store);
    const created = firstManager.create({ name: "before rename", command: "echo ok", cwd: dir });
    firstManager.rename(created.id, "after rename");

    const secondFactory = new FakeTerminalFactory();
    const secondManager = new ConsoleManager(settings, new LogStore(settings), secondFactory, store);
    const list = secondManager.list();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: "after rename", command: "echo ok", cwd: dir });
    expect(secondFactory.sessions).toHaveLength(0);
  });

  it("supports signals, restart and MCP tools", async () => {
    const created = await request(app).post("/api/consoles").send({ command: "pwsh", cwd: dir }).expect(200);
    await request(app).post(`/api/consoles/${created.body.id}/signal`).send({ signal: "ctrl+c" }).expect(200);
    expect(factory.sessions[0].writes.at(-1)).toBe("\x03");

    const restarted = await request(app).post(`/api/consoles/${created.body.id}/restart`).expect(200);
    expect(restarted.body.id).toBe(created.body.id);
    expect(factory.sessions[0].killed).toBe(true);

    const tools = await request(app).post("/mcp").send({ method: "tools/list" }).expect(200);
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toContain("list_consoles");
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(["create_console", "close_console", "restart_console", "restart_project_except_no_run", "send_console_command", "run_console_command", "get_console_state", "import_codex_contexts"]));
    expect(tools.body.tools.find((tool: { name: string }) => tool.name === "run_console_command").description).toContain("wait");
    expect(tools.body.tools.find((tool: { name: string }) => tool.name === "get_console_state").description).toContain("last input");

    const read = await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "read_console", arguments: { id: restarted.body.id } } })
      .expect(200);
    expect(read.body.content[0].type).toBe("text");

    const stateRead = await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "get_console_state", arguments: { id: restarted.body.id, tailLines: 3 } } })
      .expect(200);
    expect(JSON.parse(stateRead.body.content[0].text)).toMatchObject({ id: restarted.body.id, tailLines: expect.any(Array) });

    await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "write_console", arguments: { id: restarted.body.id, data: "echo ok\r" } } })
      .expect(200);
    expect(factory.sessions.at(-1)?.writes.at(-1)).toBe("echo ok\r");

    const sent = await manager.runCommand(restarted.body.id, "echo sent", { wait: false });
    expect(sent.status).toBe("started");
    expect(factory.sessions.at(-1)?.writes.at(-1)).toBe("echo sent\r");

    const waited = manager.runCommand(restarted.body.id, "echo waited", { wait: true, timeoutMs: 1000 });
    await waitFor(() => factory.sessions.at(-1)?.writes.some((write) => write.includes("__YCONHOST_DONE_")) ?? false);
    const markerWrite = factory.sessions.at(-1)?.writes.find((write) => write.includes("__YCONHOST_DONE_")) ?? "";
    const marker = markerWrite.match(/(__YCONHOST_DONE_[a-f0-9]+)/)?.[1];
    expect(marker).toBeTruthy();
    factory.sessions.at(-1)?.push(`waited\r\n${marker}:0\r\n`);
    await expect(waited).resolves.toMatchObject({ status: "completed", exitCode: 0, output: expect.stringContaining("waited") });

    const mcpCreated = await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "create_console", arguments: { name: "mcp", command: "echo mcp", cwd: dir } } })
      .expect(200);
    const createdFromMcp = JSON.parse(mcpCreated.body.content[0].text);
    expect(createdFromMcp).toMatchObject({ name: "mcp", command: "echo mcp" });

    await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "close_console", arguments: { id: createdFromMcp.id } } })
      .expect(200);
    expect(() => manager.get(createdFromMcp.id)).toThrow(/not found/);
  });

});
