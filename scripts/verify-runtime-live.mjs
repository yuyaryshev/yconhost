import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import xtermHeadless from "@xterm/headless";

if (!process.argv.includes("--allow-live-restart")) throw new Error("This verification restarts yconhost; pass --allow-live-restart only in an approved maintenance window");
const pm2Path = process.argv[process.argv.indexOf("--pm2") + 1];
if (!pm2Path || !fs.existsSync(pm2Path)) throw new Error("--pm2 <absolute pm2 CLI path> is required");
const execute = promisify(execFile);
const base = "http://127.0.0.1:4011";
const directory = path.resolve("data/runtime-verification");
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "README.md"), "Completion fixture\n");
const trace = path.join(directory, `ticks-${Date.now()}.txt`);
const ids = [];
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function pm2(...args) { return (await execute(process.execPath, [pm2Path, ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout; }
async function processInfo(name) { return JSON.parse(await pm2("jlist")).find(item => item.name === name); }
async function api(url, method = "GET", body) {
  const response = await fetch(base + url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}: ${JSON.stringify(value)}`);
  return value;
}
async function until(check, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (true) {
    try { if (await check()) return; } catch { /* A restart temporarily removes HTTP. */ }
    if (Date.now() > deadline) throw new Error("Live runtime verification timed out");
    await delay(100);
  }
}
function check(value, name) { if (!value) throw new Error(name); checks.push(name); }
async function snapshot(id) {
  const value = await new Promise((resolve, reject) => {
    const socket = new WebSocket(base.replace("http", "ws") + "/ws");
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("Snapshot timed out")); }, 15_000);
    socket.on("error", reject);
    socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", consoleId: id })));
    socket.on("message", raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === "snapshot") { clearTimeout(timer); socket.close(); resolve(data); }
      if (data.type === "error") { clearTimeout(timer); socket.close(); reject(new Error(data.message)); }
    });
  });
  const terminal = new xtermHeadless.Terminal({ cols: value.cols, rows: value.rows, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write(value.output, resolve));
    return { ...value, text: Array.from({ length: terminal.rows }, (_, index) => terminal.buffer.active.getLine(index)?.translateToString(true) ?? "").join("\n"), alternate: terminal.buffer.active.type === "alternate", bracketedPaste: terminal.modes.bracketedPasteMode };
  } finally { terminal.dispose(); }
}

let failure;
await until(async () => (await api("/api/health")).ok);
const before = (await api("/api/consoles")).consoles;
const hostPid = (await processInfo("yconhost-terminal-host")).pid;
try {
  const tui = await api("/api/consoles", "POST", { project: "AGENTS_TEMP", name: "runtime_check_tui", persistent: false, cwd: directory, shell: process.execPath, args: [path.resolve("scripts/fixtures/runtime-tui.mjs"), trace] });
  ids.push(tui.id);
  const shell = await api("/api/consoles", "POST", { project: "AGENTS_TEMP", name: "runtime_check_completion", persistent: false, cwd: directory, shell: "cmd.exe", args: ["/d", "/q", "/k"] });
  ids.push(shell.id);
  await until(async () => (await api(`/api/consoles/${tui.id}/state`)).pid && (await api(`/api/consoles/${shell.id}/state`)).pid);
  await until(async () => (await snapshot(tui.id)).text.includes("Runtime test PID"));
  const stateBefore = await api(`/api/consoles/${tui.id}/state`);
  const shellBefore = await api(`/api/consoles/${shell.id}/state`);
  await api(`/api/consoles/${tui.id}/input`, "POST", { data: "before-" });
  await api(`/api/consoles/${shell.id}/input`, "POST", { data: "READ\t" });
  await until(async () => (await snapshot(shell.id)).text.includes("README.md"));
  check(true, "Tab completion works through the terminal host");
  const native = await api(`/api/consoles/${tui.id}/native`);
  const ticks = () => fs.readFileSync(trace, "utf8").trim().split("\n").length;
  const ticksBefore = ticks();
  await pm2("stop", "yconhost");
  await delay(1200);
  process.kill(stateBefore.pid, 0); process.kill(shellBefore.pid, 0);
  check(ticks() > ticksBefore + 5, "TUI continues producing output while HTTP is stopped");
  await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LiveRuntimeKeys {
      [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    }';
    'native-'.ToCharArray() | ForEach-Object { [LiveRuntimeKeys]::SendMessage([IntPtr]::new(${native.hwnd}),258,[IntPtr][int]$_,[IntPtr]1) | Out-Null }
  `], { windowsHide: true, timeout: 10_000 });
  await pm2("start", "yconhost");
  await until(async () => (await api("/api/health")).ok);
  const restored = await api(`/api/consoles/${tui.id}/state`);
  check(restored.pid === stateBefore.pid && restored.runId === stateBefore.runId && restored.lastStartedAt === stateBefore.lastStartedAt, "Graceful HTTP restart preserves PID, run ID and start time");
  check((await api(`/api/consoles/${shell.id}/state`)).pid === shellBefore.pid && (await snapshot(shell.id)).text.includes("README.md"), "The pending completed command survives without Enter");
  await api(`/api/consoles/${tui.id}/input`, "POST", { data: "after" });
  await until(async () => (await snapshot(tui.id)).text.includes("before-native-after"));
  const screen = await snapshot(tui.id);
  check(screen.alternate && screen.bracketedPaste, "TUI alternate screen and input modes survive reconnect");
  check(true, "Native input while HTTP is absent and browser/API input share the original process");
  await api(`/api/consoles/${shell.id}/input`, "POST", { data: "\x7f".repeat(100) });
  await until(async () => (await snapshot(shell.id)).text.toLowerCase().includes(directory.toLowerCase() + ">"));
  check(true, "Backspace cannot erase the cmd prompt");
  const httpPid = (await processInfo("yconhost")).pid;
  process.kill(httpPid, "SIGKILL");
  await until(async () => (await processInfo("yconhost")).pid !== httpPid && (await api("/api/health")).ok);
  const killed = await api(`/api/consoles/${tui.id}/state`);
  check(killed.pid === stateBefore.pid && killed.runId === stateBefore.runId, "Forced HTTP termination and PM2 recovery preserve the same run");
  check((await processInfo("yconhost-terminal-host")).pid === hostPid, "The independent terminal host never restarted");
  const after = (await api("/api/consoles")).consoles.filter(item => !ids.includes(item.id));
  check(after.length === before.length && before.every(item => after.some(current => current.id === item.id && current.command === item.command)), "Existing slots and launch commands remain unchanged");
  check(!after.some(item => !item.readonly && item.pid), "No user console was automatically started");
} catch (error) { failure = error; }
finally {
  await pm2("start", "yconhost");
  await until(async () => (await api("/api/health")).ok);
  for (const id of ids) { try { await api(`/api/consoles/${id}`, "DELETE"); } catch { /* Keep the original failure. */ } }
  await until(async () => !(await api("/api/consoles")).consoles.some(item => ids.includes(item.id)));
}
const result = { at: new Date().toISOString(), checks, terminalHostPid: hostPid, failure: failure?.message };
fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failure) throw failure;
