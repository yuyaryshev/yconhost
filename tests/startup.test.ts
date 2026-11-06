import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const execute = promisify(execFile);
let directory: string;
let settingsPath: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-startup-"));
  settingsPath = path.join(directory, "settings.json5");
  fs.writeFileSync(path.join(directory, "folder-sources-v1.json"), "{}");
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

function launch(port: number) {
  fs.writeFileSync(settingsPath, JSON.stringify({ dataDir: directory, host: "127.0.0.1", port }));
  return execute(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: process.cwd(), env: { ...process.env, YCONHOST_SETTINGS_PATH: settingsPath }, windowsHide: true, timeout: 8000
  });
}

it("uses fixed port 4011 without a file or environment override", async () => {
  const previous = process.env.YCONHOST_PORT;
  delete process.env.YCONHOST_PORT;
  try {
    vi.resetModules();
    const { loadSettings } = await import("../src/server/settings.js");
    expect(loadSettings(path.join(directory, "absent.json5")).port).toBe(4011);
  } finally {
    if (previous === undefined) delete process.env.YCONHOST_PORT;
    else process.env.YCONHOST_PORT = previous;
  }
});

it("exits with code 1 instead of staying online without a server after corrupt state", async () => {
  fs.writeFileSync(path.join(directory, "managed-projects.json"), Buffer.alloc(64));
  await expect(launch(0)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Startup failed") });
}, 10000);

it("fails on an occupied configured port instead of selecting another one", async () => {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await expect(launch(port)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("EADDRINUSE"), stdout: "" });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}, 10000);
