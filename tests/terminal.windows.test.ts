import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PtyTerminalFactory, type TerminalSession } from "../src/server/terminal.js";

function hostCount(): number {
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-CimInstance Win32_Process -Filter \"(Name='conhost.exe' OR Name='OpenConsole.exe') AND ParentProcessId=${process.pid}\").Count`
  ], { encoding: "utf8", windowsHide: true }));
}

async function eventually(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Terminal cleanup timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

it.runIf(process.platform === "win32")("releases ConPTY hosts after silent exit, forced close and interactive input", async () => {
  const factory = new PtyTerminalFactory();
  const baseline = hostCount();
  const messagePorts = () => process.getActiveResourcesInfo().filter((name) => name === "MessagePort").length;
  const baselinePorts = messagePorts();
  const sessions: TerminalSession[] = [];
  const spawn = (args: string[]) => {
    const session = factory.spawn("cmd.exe", args, { cwd: process.cwd(), env: process.env, cols: 80, rows: 24 });
    sessions.push(session);
    return session;
  };
  try {
    for (let i = 0; i < 4; i++) {
      let exited = false;
      const session = spawn(["/d", "/q", "/c", "exit 0"]);
      session.onExit(() => { exited = true; });
      await eventually(() => exited);
      await eventually(() => hostCount() === baseline);
    }
    for (let i = 0; i < 4; i++) {
      const session = spawn(["/d", "/q", "/k"]);
      session.kill();
      await eventually(() => hostCount() === baseline);
    }
    const interactive = spawn(["/d", "/q", "/k"]);
    let output = "";
    interactive.onData((chunk) => { output += chunk; });
    interactive.write("echo YCONHOST_INPUT_OK\r");
    await eventually(() => output.includes("YCONHOST_INPUT_OK"));
    interactive.kill();
    await eventually(() => hostCount() === baseline);
    const child = spawn(["/d", "/q", "/k"]);
    let childOutput = "";
    child.onData((chunk) => { childOutput += chunk; });
    child.write(`node -e "console.log('YCONHOST_CHILD:' + process.pid);setInterval(()=>{},1000)"\r`);
    await eventually(() => /YCONHOST_CHILD:\d+/.test(childOutput));
    const childPid = Number(childOutput.match(/YCONHOST_CHILD:(\d+)/)?.[1]);
    child.kill();
    await eventually(() => {
      try { process.kill(childPid, 0); return false; } catch { return true; }
    });
    await eventually(() => hostCount() === baseline);
    await eventually(() => messagePorts() <= baselinePorts);
  } finally {
    for (const session of sessions) session.kill();
  }
}, 60_000);
