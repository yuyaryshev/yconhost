import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import xtermHeadless from "@xterm/headless";
import { expect, it } from "vitest";
import { PtyTerminalFactory, type TerminalSession } from "../src/server/terminal.js";

const executable = process.env.YOPENCONSOLE_EXE ?? "D:\\b\\Mine\\GIT_Work\\yopenconsole\\bin\\x64\\Release\\yopenconsole.exe";
async function until(check: () => boolean, timeout = 12_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Native console condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function nativeKeys(hwnd: string, text: string, close = false): void {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NativeCliTest {
      [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wp, IntPtr lp);
    }';
    $h=[IntPtr]::new(${hwnd});
    ${close ? "[NativeCliTest]::SendMessage($h,16,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null" : `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text).toString("base64")}')).ToCharArray() | ForEach-Object { [NativeCliTest]::SendMessage($h,258,[IntPtr][int]$_,[IntPtr]1) | Out-Null }`}
  `], { windowsHide: true, timeout: 10_000 });
}

it.runIf(process.platform === "win32" && fs.existsSync(executable))("shares real input/output, hides on native close and cleans up the worker", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-native-"));
  const factory = new PtyTerminalFactory();
  const title = `YCONHOST_NATIVE_${crypto.randomUUID()}`;
  const sessions: TerminalSession[] = [];
  try {
    const session = factory.spawn("cmd.exe", ["/d", "/q", "/k", `title ${title}`], {
      cwd: process.cwd(), env: process.env, cols: 100, rows: 30,
      host: "yopenconsole", yopenconsolePath: executable, dataDir
    });
    sessions.push(session);
    let ready = false;
    let exited = false;
    let exitCode: number | undefined;
    let output = "";
    session.onReady!(() => { ready = true; });
    const mirror = new xtermHeadless.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
    const screen = () => Array.from({ length: mirror.rows }, (_, y) => mirror.buffer.active.getLine(y)?.translateToString(true) ?? "").join("\n");
    session.onData((chunk) => { output += chunk; mirror.write(chunk); });
    session.onExit((code) => { exited = true; exitCode = code; });
    await until(() => ready || exited);
    expect(exited, output).toBe(false);
    const pid = session.pid;
    expect((await session.nativeWindow!()).visible).toBe(false);
    const shown = await session.nativeWindow!(true);
    expect(shown.visible).toBe(true);
    const hwnd = shown.hwnd!;
    session.write("echo BROWSER_TO_NATIVE\r");
    await until(() => output.includes("BROWSER_TO_NATIVE"));
    const mark = output.length;
    nativeKeys(hwnd, "echo NATIVE_PARTIAL");
    await until(() => screen().includes("echo NATIVE_PARTIAL"));
    nativeKeys(hwnd, "\r");
    await until(() => output.slice(mark).includes("NATIVE_PARTIAL\r\n"));
    nativeKeys(hwnd, "", true);
    expect((await session.nativeWindow!()).visible).toBe(false);
    expect(session.pid).toBe(pid);
    expect(exited).toBe(false);
    expect((await session.nativeWindow!(true)).visible).toBe(true);
    expect((await session.nativeWindow!(false)).visible).toBe(false);
    session.write("exit 7\r");
    await until(() => exited);
    expect(exitCode).toBe(7);
    mirror.dispose();
    await until(() => { try { process.kill(pid!, 0); return false; } catch { return true; } });

    // A silent shell may exit before its control pipe is ready.
    const silent = factory.spawn("cmd.exe", ["/d", "/q", "/c", "exit 0"], {
      cwd: process.cwd(), env: process.env, cols: 100, rows: 30,
      host: "yopenconsole", yopenconsolePath: executable, dataDir
    });
    sessions.push(silent);
    let silentExited = false;
    silent.onExit(() => { silentExited = true; });
    await until(() => silentExited);

    const immediate = factory.spawn("cmd.exe", ["/d", "/q", "/k"], {
      cwd: process.cwd(), env: process.env, cols: 100, rows: 30,
      host: "yopenconsole", yopenconsolePath: executable, dataDir
    });
    sessions.push(immediate);
    let immediateExited = false;
    immediate.onExit(() => { immediateExited = true; });
    immediate.kill();
    await until(() => immediateExited);
    const remainingHosts = () => Number(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `@(Get-CimInstance Win32_Process -Filter \"Name='OpenConsole.exe'\" | Where-Object { $_.ExecutablePath -like '${dataDir}*' }).Count`
    ], { encoding: "utf8", windowsHide: true }));
    await until(() => remainingHosts() === 0);
  } finally {
    for (const session of sessions) session.kill();
  }
}, 60_000);
