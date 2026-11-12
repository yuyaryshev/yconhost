import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parseProcessList, readOutput } from "../src/server/folders/pm2.mjs";

it("parses PM2 warning-prefixed JSON into external readonly definitions", () => {
  const entries = parseProcessList('>>>> PM2 warning\n[{"pm_id":1,"name":"service","pid":123,"pm2_env":{"status":"online","pm_exec_path":"app.js","args":["--test"]}}]');
  expect(entries).toEqual([expect.objectContaining({ key: "1", name: "service", readonly: true, command: "app.js --test", external: expect.objectContaining({ status: "running", pid: 123 }) })]);
  expect(() => parseProcessList("not a list")).toThrow();
});

it("reads bounded stdout/stderr tails, including missing logs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-pm2-log-"));
  try {
    const stdout = path.join(dir, "out.log");
    fs.writeFileSync(stdout, `${"old\n".repeat(400000)}latest\n`);
    const output = readOutput({}, { stdout, stderr: path.join(dir, "missing.log") }, { tailLines: 2 });
    expect(output).toContain("latest");
    expect(output.length).toBeLessThan(100);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it("retains same-name processes with separate PM2 IDs and output files", () => {
  const entries = parseProcessList(JSON.stringify([
    { pm_id: 1, name: "yconhost", pid: 100, pm2_env: { pm_out_log_path: "one.log" } },
    { pm_id: 2, name: "yconhost", pid: 200, pm2_env: { pm_out_log_path: "two.log" } }
  ]));
  expect(entries.map((item) => item.name)).toEqual(["yconhost", "yconhost"]);
  expect(entries.map((item) => item.key)).toEqual(["1", "2"]);
  expect(entries.map((item) => item.description)).toEqual(["PM2 ID: 1", "PM2 ID: 2"]);
  expect(entries.map((item) => item.values.stdout)).toEqual(["one.log", "two.log"]);
});
