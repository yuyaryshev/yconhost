import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexSession } from "../src/server/folders/codexSession.mjs";

describe("Codex session bootstrap", () => {
  let directory: string;
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-codex-rpc-")); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  function fixture(mode = "success") {
    const file = path.join(directory, "server.mjs");
    fs.writeFileSync(file, `
      import fs from 'node:fs';
      import { createInterface } from 'node:readline';
      const mode = ${JSON.stringify(mode)};
      createInterface({ input: process.stdin }).on('line', line => {
        const call = JSON.parse(line);
        fs.appendFileSync(${JSON.stringify(path.join(directory, "requests.jsonl"))}, line + '\\n');
        if (!call.id || mode === 'timeout') return;
        if (mode === 'exit') process.exit(3);
        if (mode === 'error' && call.method === 'thread/archive') {
          console.log(JSON.stringify({ id: call.id, error: { message: 'cannot persist thread' } })); return;
        }
        console.log(JSON.stringify({ method: 'thread/started', params: {} }));
        const result = call.method === 'thread/start' ? { thread: { id: mode === 'invalid' ? 'invalid' : '01234567-1234-7123-8123-0123456789ab' } } : {};
        console.log(JSON.stringify({ id: call.id, result }));
      });
    `);
    return { cwd: directory, name: "Test session", executable: process.execPath, args: [file], timeoutMs: 3000 };
  }

  it("persists a fresh thread, names it and verifies history without sending a model turn", async () => {
    const id = await createCodexSession(fixture());
    expect(id).toBe("01234567-1234-7123-8123-0123456789ab");
    const calls = fs.readFileSync(path.join(directory, "requests.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.map((call) => call.method)).toEqual(["initialize", "initialized", "thread/start", "thread/archive", "thread/unarchive", "thread/name/set", "thread/read"]);
    expect(calls.find((call) => call.method === "thread/start").params).toMatchObject({ cwd: directory, ephemeral: false });
    expect(calls.find((call) => call.method === "thread/name/set").params).toEqual({ threadId: id, name: "Test session" });
  });

  it.each(["error", "invalid", "exit", "timeout"])("rejects %s and cleans up its child", async (mode) => {
    const options = fixture(mode);
    if (mode === "timeout") options.timeoutMs = 100;
    await expect(createCodexSession(options)).rejects.toThrow(mode === "error" ? "cannot persist" : mode === "invalid" ? "invalid session" : mode === "timeout" ? "timed out" : "exited");
  });
});
