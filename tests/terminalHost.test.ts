import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import xtermHeadless from "@xterm/headless";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TerminalHost } from "../src/server/terminalHost.js";
import { RuntimeClient } from "../src/server/runtimeClient.js";
import { FakeTerminalFactory } from "../src/server/terminal.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { ConsoleStore } from "../src/server/consoleStore.js";
import { ProjectStore } from "../src/server/projectStore.js";
import { LogStore } from "../src/server/logStore.js";
import { loadSettings } from "../src/server/settings.js";
import { runtimeTokenPath } from "../src/server/runtimeProtocol.js";
import { createApp } from "../src/server/api.js";

async function until(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Runtime condition timed out");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

describe("Persistent terminal host", () => {
  let dir: string;
  let settings: ReturnType<typeof loadSettings>;
  let host: TerminalHost;
  let factory: FakeTerminalFactory;
  let client: RuntimeClient;
  let manager: ConsoleManager;

  async function connect() {
    client = new RuntimeClient(dir);
    manager = new ConsoleManager(settings, new LogStore(settings), client, new ConsoleStore(settings), new ProjectStore(settings));
    await manager.initializeRuntime();
  }
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-runtime-"));
    settings = { ...loadSettings(path.join(dir, "absent")), dataDir: dir };
    factory = new FakeTerminalFactory();
    host = new TerminalHost(settings, factory);
    await host.listen();
    await connect();
  });
  afterEach(async () => { manager?.dispose(); client?.disconnect(); await host?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it("reattaches existing runs, preserves partial input and read marks, logs offline output once and never starts idle slots", async () => {
    const idle = manager.registerConsole({ project: "Tasks", name: "Idle", noRun: true });
    const running = manager.create({ project: "Tasks", name: "Live", command: "echo live" });
    await until(() => manager.get(running.id).status === "running");
    await manager.write(running.id, "partial-input");
    factory.sessions[0].push("\r\nError: before restart\r\n");
    await until(() => manager.get(running.id).outputTail.includes("before restart"));
    manager.markRead(running.id);
    const before = manager.get(running.id);
    manager.dispose();
    expect(factory.sessions[0].killed).toBe(false);
    factory.sessions[0].push("Warning: while HTTP offline\r\n");
    await new Promise(resolve => setTimeout(resolve, 130));
    await connect();
    const after = manager.get(running.id);
    expect(after).toMatchObject({ pid: before.pid, runId: before.runId, lastStartedAt: before.lastStartedAt, lastInputAt: before.lastInputAt, status: "running" });
    expect(after.cards.find(card => card.message.includes("before restart"))?.read).toBe(true);
    expect(after.outputTail.match(/while HTTP offline/g)).toHaveLength(1);
    expect(manager.get(idle.id).status).toBe("idle");
    expect(factory.sessions).toHaveLength(1);
    expect((await manager.terminalScreen(running.id)).output).toContain("partial-input");
    await manager.write(running.id, " after-reconnect");
    expect(factory.sessions[0].writes).toEqual(["partial-input", " after-reconnect"]);
    manager.stop(running.id);
    await until(() => factory.sessions[0].killed);
  });

  it("restores alternate-buffer contents, styles, cursor and input modes from canonical xterm state", async () => {
    const running = manager.create({ name: "TUI" });
    await until(() => manager.get(running.id).status === "running");
    factory.sessions[0].push("normal screen\x1b[?1049h\x1b[2J\x1b[3;5H\x1b[31mTUI\x1b[0m\x1b[?2004h\x1b[?1000h");
    await until(() => manager.get(running.id).outputTail.includes("TUI"));
    manager.dispose();
    await connect();
    const snapshot = await manager.terminalScreen(running.id);
    const mirror = new xtermHeadless.Terminal({ cols: snapshot.cols, rows: snapshot.rows, allowProposedApi: true });
    try {
      await new Promise<void>(resolve => mirror.write(snapshot.output, resolve));
      expect(mirror.buffer.active.type).toBe("alternate");
      expect(mirror.buffer.active.getLine(2)?.translateToString(true)).toBe("    TUI");
      expect(mirror.buffer.active.cursorX).toBe(7);
      expect(mirror.buffer.active.cursorY).toBe(2);
      expect(mirror.modes.bracketedPasteMode).toBe(true);
      expect(mirror.modes.mouseTrackingMode).toBe("vt200");
      expect(mirror.buffer.active.getLine(2)?.getCell(4)?.getFgColor()).toBe(1);
    } finally { mirror.dispose(); }
  });

  it("restarts only the requested run without stale close messages killing its replacement", async () => {
    const running = manager.create({ project: "Tasks", name: "Restart" });
    await until(() => manager.get(running.id).status === "running");
    const before = manager.get(running.id);
    manager.restart(running.id);
    await until(() => factory.sessions.length === 2 && manager.get(running.id).status === "running");
    expect(factory.sessions[0].killed).toBe(true);
    expect(factory.sessions[1].killed).toBe(false);
    expect(manager.get(running.id).runId).not.toBe(before.runId);
    await expect(client.request("close", { consoleId: running.id, runId: before.runId })).rejects.toThrow("superseded");
    expect(factory.sessions[1].killed).toBe(false);
  });

  it("returns a delivery error when host connectivity is lost, and never retries input on reconnect", async () => {
    const running = manager.create({ name: "Connectivity" });
    await until(() => manager.get(running.id).status === "running");
    client.disconnect();
    await until(() => !manager.runtimeAvailable());
    await request(createApp(manager)).post(`/api/consoles/${running.id}/input`).send({ data: "must-not-execute" }).expect(400);
    await request(createApp(manager)).get("/api/health").expect(503);
    expect(factory.sessions[0].writes).toEqual([]);
    expect(factory.sessions[0].killed).toBe(false);
    manager.dispose();
    await connect();
    expect(factory.sessions[0].writes).toEqual([]);
    await manager.write(running.id, "once");
    expect(factory.sessions[0].writes).toEqual(["once"]);
  });

  it("keeps naturally exited runs stopped during recovery and does not respawn after a fresh host", async () => {
    const running = manager.create({ name: "Exit" });
    await until(() => manager.get(running.id).status === "running");
    factory.sessions[0].kill();
    await until(() => manager.get(running.id).status === "exited");
    manager.dispose();
    await connect();
    expect(manager.get(running.id).status).toBe("exited");
    expect(factory.sessions).toHaveLength(1);
    manager.dispose();
    await host.close();
    factory = new FakeTerminalFactory();
    host = new TerminalHost(settings, factory);
    await host.listen();
    await connect();
    expect(manager.get(running.id).status).toBe("idle");
    expect(factory.sessions).toHaveLength(0);
  });

  it("authenticates pipe clients, rejects stale operations and deduplicates a repeated acknowledged input request", async () => {
    const running = manager.create({ name: "Dedup" });
    await until(() => manager.get(running.id).status === "running");
    const socket = net.createConnection(host.address);
    const replies = new Map<string, any>();
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) { const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); if (message.id) replies.set(message.id, message); }
    });
    const rpc = async (id: string, method: string, args: unknown, expiresAt = Date.now() + 50_000) => {
      replies.delete(id); socket.write(`${JSON.stringify({ id, method, args, expiresAt })}\n`);
      await until(() => replies.has(id)); return replies.get(id);
    };
    try {
      const token = JSON.parse(fs.readFileSync(runtimeTokenPath(dir), "utf8")).token;
      expect((await rpc("auth", "hello", { token, version: 1 })).result.version).toBe(1);
      const id = crypto.randomUUID();
      const args = { consoleId: running.id, runId: manager.get(running.id).runId, data: "unique" };
      await rpc(id, "input", args);
      await rpc(id, "input", args);
      expect(factory.sessions[0].writes).toEqual(["unique"]);
      expect((await rpc("expired", "input", args, Date.now() - 1)).error).toContain("Expired");
    } finally { socket.destroy(); }
    const bad = net.createConnection(host.address);
    try {
      const message = new Promise<string>(resolve => bad.once("data", chunk => resolve(chunk.toString())));
      bad.write(JSON.stringify({ id: "bad", method: "hello", args: { version: 1, token: "a".repeat(64) } }) + "\n");
      expect(await message).toContain("authentication/protocol mismatch");
    } finally { bad.destroy(); }
  });
});
