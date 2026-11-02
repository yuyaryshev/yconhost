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
