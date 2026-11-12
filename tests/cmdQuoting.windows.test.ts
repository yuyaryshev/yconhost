import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PtyTerminalFactory, type TerminalSession } from "../src/server/terminal.js";

for (const backend of ["standard", "yopenconsole"] as const) {
  const executable = "D:\\b\\Mine\\GIT_Work\\yopenconsole\\bin\\x64\\Release\\yopenconsole.exe";
  it.runIf(process.platform === "win32" && (backend === "standard" || fs.existsSync(executable)))(`preserves cmd launch quoting with ${backend}`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-cmd-quotes-"));
    const cwd = path.join(directory, "folder & spaces");
    fs.mkdirSync(cwd);
    const factory = new PtyTerminalFactory();
    const sessions: TerminalSession[] = [];
    try {
      for (const command of [
        `cls && title quoting-test && cd /d "${cwd}" && "${process.execPath}" -e "process.stdout.write('FIRST_OK:'+process.cwd())"`,
        `"${process.execPath}" -e "process.stdout.write('SECOND_OK:'+process.argv[1])" "argument with spaces"`
      ]) {
        let output = "";
        let exit: number | undefined;
        let exited = false;
        const session = factory.spawn("cmd.exe", ["/d", "/q", "/c", command], {
          cwd: directory, env: process.env, cols: 300, rows: 40, host: backend,
          yopenconsolePath: executable, dataDir: directory
        });
        sessions.push(session);
        session.onData((chunk) => { output += chunk; });
        session.onExit((code) => { exit = code; exited = true; });
        const deadline = Date.now() + 10_000;
        while (!exited && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
        expect(exited, output).toBe(true);
        expect(exit, output).toBe(0);
        expect(output).toContain(command.startsWith("cls") ? `FIRST_OK:${cwd}` : "SECOND_OK:argument with spaces");
        expect(output).not.toContain("syntax is incorrect");
      }
    } finally {
      for (const session of sessions) session.kill();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
}
