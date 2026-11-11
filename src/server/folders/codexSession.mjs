import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

// Use Codex's own persistence APIs, never manufacture rollout files or session IDs.
/** @param {{cwd: string, name: string, env?: NodeJS.ProcessEnv, executable?: string, args?: string[], timeoutMs?: number}} options */
export async function createCodexSession({ cwd, name, env = process.env, executable = "ycodex", args = [], timeoutMs = 25_000 }) {
  const windows = process.platform === "win32";
  let file = executable;
  if (windows && !/[\\/]/.test(file)) {
    file = execFileSync("where.exe", [file], { env, windowsHide: true, encoding: "utf8", timeout: 3000 }).trim().split(/\r?\n/).find((candidate) => /\.(exe|cmd|bat)$/i.test(candidate));
    if (!file) throw new Error(`Cannot find ${executable} in PATH`);
  }
  const parameters = [...args, "--bypass-safety-y", "--disable", "memories", "app-server", "--listen", "stdio://"];
  const batch = windows && /\.(cmd|bat)$/i.test(file);
  if (batch && /["%\r\n]/.test(file)) throw new Error("Unsupported Codex executable path");
  const child = batch
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${file}" ${parameters.map((arg) => `"${arg}"`).join(" ")}"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true, stdio: "pipe" })
    : spawn(file, parameters, { cwd, env, windowsHide: true, stdio: "pipe" });
  const lines = createInterface({ input: child.stdout });
  let serial = 0;
  let failure;
  const pending = new Map();
  const fail = (error) => {
    failure = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stderr.resume();
  child.on("exit", (code) => fail(new Error(`Codex app-server exited (${code})`)));
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(`Codex: ${message.error.message}`));
    else call.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++serial;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const timer = setTimeout(() => fail(new Error(`Codex session creation timed out after ${timeoutMs} ms`)), timeoutMs);
  try {
    await request("initialize", { clientInfo: { name: "yconhost", version: "0.1.0" }, capabilities: {} });
    child.stdin.write('{"jsonrpc":"2.0","method":"initialized"}\n');
    const { thread } = await request("thread/start", { cwd, ephemeral: false, approvalPolicy: "never", sandbox: "danger-full-access" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread?.id ?? "")) throw new Error("Codex returned an invalid session ID");
    // Empty threads are initially staged. Archival materializes them without a model turn.
    await request("thread/archive", { threadId: thread.id });
    await request("thread/unarchive", { threadId: thread.id });
    await request("thread/name/set", { threadId: thread.id, name });
    await request("thread/read", { threadId: thread.id, includeTurns: true });
    return thread.id;
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.exitCode === null && child.pid) {
      if (windows) {
        await new Promise((resolve) => {
          const kill = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          kill.once("error", resolve); kill.once("exit", resolve);
        });
      } else child.kill();
    }
    child.stdin.destroy();
  }
}
