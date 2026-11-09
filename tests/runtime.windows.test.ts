import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import xtermHeadless from "@xterm/headless";
import { expect, it } from "vitest";
import { TerminalHost } from "../src/server/terminalHost.js";
import { RuntimeClient } from "../src/server/runtimeClient.js";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { ConsoleStore } from "../src/server/consoleStore.js";
import { LogStore } from "../src/server/logStore.js";
import { loadSettings } from "../src/server/settings.js";

async function until(check: () => Promise<boolean> | boolean, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("Durable Windows session timed out");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

for (const backend of ["standard", "yopenconsole"] as const) {
  const executable = "D:\\b\\Mine\\GIT_Work\\yopenconsole\\bin\\x64\\Release\\yopenconsole.exe";
  it.runIf(process.platform === "win32" && (backend === "standard" || fs.existsSync(executable)))(`preserves a real ${backend} TUI and PID through HTTP ownership loss, and still closes explicitly`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-durable-win-"));
    const settings = { ...loadSettings(path.join(dir, "absent")), dataDir: dir };
    settings.terminal = { ...settings.terminal, host: backend, yopenconsolePath: executable };
    const host = new TerminalHost(settings);
    await host.listen();
    let client: RuntimeClient;
    let manager: ConsoleManager;
    const connect = async () => {
      client = new RuntimeClient(dir);
      manager = new ConsoleManager(settings, new LogStore(settings), client, new ConsoleStore(settings));
      await manager.initializeRuntime();
    };
    await connect();
    let pid: number | undefined;
    try {
      const record = manager!.create({ project: "Tests", name: "TUI", cwd: dir, shell: process.execPath, args: [path.resolve("scripts/fixtures/runtime-tui.mjs"), path.join(dir, "ticks.txt")] });
      await until(() => Boolean(manager!.get(record.id).pid && manager!.get(record.id).outputTail.includes("Runtime test PID")));
      pid = manager!.get(record.id).pid;
      const runId = manager!.get(record.id).runId;
      await manager!.write(record.id, "before-");
      if (backend === "yopenconsole") {
        const native = await manager!.nativeWindow(record.id);
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
          Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DurableNativeKeys {
            [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
          }';
          'native-'.ToCharArray() | ForEach-Object { [DurableNativeKeys]::SendMessage([IntPtr]::new(${native.hwnd}),258,[IntPtr][int]$_,[IntPtr]1) | Out-Null }
        `], { windowsHide: true, timeout: 10_000 });
      }
      const ticksBefore = fs.readFileSync(path.join(dir, "ticks.txt"), "utf8").split("\n").length;
      manager!.dispose();
      await new Promise(resolve => setTimeout(resolve, 700));
      process.kill(pid!, 0);
      expect(fs.readFileSync(path.join(dir, "ticks.txt"), "utf8").split("\n").length).toBeGreaterThan(ticksBefore + 3);
      await connect();
      expect(manager!.get(record.id)).toMatchObject({ pid, runId, status: "running" });
      await manager!.write(record.id, "after");
      await until(async () => {
        const snapshot = await manager!.terminalScreen(record.id);
        const mirror = new xtermHeadless.Terminal({ cols: snapshot.cols, rows: snapshot.rows, allowProposedApi: true });
        try {
          await new Promise<void>(resolve => mirror.write(snapshot.output, resolve));
          expect(mirror.buffer.active.type).toBe("alternate");
          expect(mirror.modes.bracketedPasteMode).toBe(true);
          return mirror.buffer.active.getLine(2)?.translateToString(true).includes(backend === "yopenconsole" ? "before-native-after" : "before-after") ?? false;
        } finally { mirror.dispose(); }
      });
      if (backend === "yopenconsole") expect((await manager!.nativeWindow(record.id)).visible).toBe(false);
      manager!.stop(record.id);
      await until(() => { try { process.kill(pid!, 0); return false; } catch { return true; } });
    } finally {
      manager!.dispose(); client!.disconnect(); await host.close(); fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
}
