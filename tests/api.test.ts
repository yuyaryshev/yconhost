import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/api.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { LogStore } from "../src/server/logStore.js";
import { FakeTerminalFactory } from "../src/server/terminal.js";
import type { AppSettings } from "../src/server/types.js";

function testSettings(dataDir: string): AppSettings {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    defaultShell: "powershell.exe",
    log: {
      maxBytes: 1024 * 1024,
      rotateFiles: 2,
      scrollbackBytes: 4096,
      trackerTailChars: 1000
    }
  };
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
    app = createApp(manager);
  });

  it("reports health", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body.ok).toBe(true);
  });

  it("creates, lists, reads, writes and deletes a console", async () => {
    const created = await request(app).post("/api/consoles").send({ name: "dev", command: "echo ok", project: "Default", cwd: dir }).expect(200);
    expect(created.body.name).toBe("dev");

    factory.sessions[0].push("hello\r\n");
    factory.sessions[0].push("\x1b[31merror happened\x1b[0m\r\n");
    factory.sessions[0].push("still running\r\n");

    const list = await request(app).get("/api/consoles").expect(200);
    expect(list.body.consoles).toHaveLength(1);
    expect(list.body.consoles[0].unseenErrorCount).toBe(2);

    const snapshot = await request(app).get(`/api/consoles/${created.body.id}`).expect(200);
    expect(snapshot.body.outputTail).toContain("hello");
    expect(snapshot.body.unseenErrorCount).toBe(0);

    const afterView = await request(app).get("/api/consoles").expect(200);
    expect(afterView.body.consoles[0].unseenErrorCount).toBe(0);

    const output = await request(app).get(`/api/consoles/${created.body.id}/output`).expect(200);
    expect(output.body.output).toContain("hello");

    const tail = await request(app).get(`/api/consoles/${created.body.id}/output?tailLines=2`).expect(200);
    expect(tail.body.output).toContain("error happened");

    await request(app).post(`/api/consoles/${created.body.id}/input`).send({ data: "dir\r" }).expect(200);
    expect(factory.sessions[0].writes.at(-1)).toBe("dir\r");

    await request(app).delete(`/api/consoles/${created.body.id}`).expect(200);
    await request(app).get(`/api/consoles/${created.body.id}`).expect(404);
  });

  it("creates consoles from my_wins.json and skips no_run entries", async () => {
    fs.writeFileSync(
      path.join(dir, "my_wins.json"),
      JSON.stringify({ wins: { watch: { cmd: "npm run watch" }, disabled: { cmd: "npm test", no_run: true } } }),
      "utf8"
    );

    const response = await request(app).post("/api/batch").send({ projectPath: dir }).expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("watch");

    const projects = await request(app).get("/api/projects").expect(200);
    expect(projects.body.projects).toContainEqual(
      expect.objectContaining({
        name: path.basename(dir),
        consoleCount: 1
      })
    );
  });

  it("validates batch projectPath", async () => {
    await request(app).post("/api/batch").send({}).expect(400);
  });

  it("supports signals, restart and MCP tools", async () => {
    const created = await request(app).post("/api/consoles").send({ command: "pwsh", cwd: dir }).expect(200);
    await request(app).post(`/api/consoles/${created.body.id}/signal`).send({ signal: "ctrl+c" }).expect(200);
    expect(factory.sessions[0].writes.at(-1)).toBe("\x03");

    const restarted = await request(app).post(`/api/consoles/${created.body.id}/restart`).expect(200);
    expect(restarted.body.id).not.toBe(created.body.id);

    const tools = await request(app).post("/mcp").send({ method: "tools/list" }).expect(200);
    expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toContain("list_consoles");

    const read = await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "read_console", arguments: { id: restarted.body.id } } })
      .expect(200);
    expect(read.body.content[0].type).toBe("text");

    await request(app)
      .post("/mcp")
      .send({ method: "tools/call", params: { name: "write_console", arguments: { id: restarted.body.id, data: "echo ok\r" } } })
      .expect(200);
    expect(factory.sessions.at(-1)?.writes.at(-1)).toBe("echo ok\r");
  });

});
