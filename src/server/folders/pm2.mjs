import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function list() {
  const executable = process.platform === "win32" ? "cmd.exe" : "pm2";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "pm2 jlist"] : ["jlist"];
  const { stdout } = await execute(executable, args, { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
  return parseProcessList(stdout);
}

export function parseProcessList(stdout) {
  const start = stdout.search(/^\s*\[\s*(?:\{|\])/m);
  if (start < 0) throw new Error("PM2 returned no process list");
  const processes = JSON.parse(stdout.slice(start));
  if (!Array.isArray(processes)) throw new Error("Invalid PM2 process list");
  return processes.map((item) => {
    const env = item.pm2_env ?? {};
    const args = Array.isArray(env.args) ? env.args : env.args ? [env.args] : [];
    const files = [env.pm_out_log_path, env.pm_err_log_path].filter(Boolean);
    const lastOutput = Math.max(0, ...files.map((file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }));
    return {
      key: String(item.pm_id ?? item.name), name: item.name ?? `pm2-${item.pm_id}`,
      command: [env.pm_exec_path, ...args].filter(Boolean).join(" "), cwd: env.pm_cwd ?? process.cwd(),
      readonly: true, ansiParserEnabled: false,
      values: { stdout: env.pm_out_log_path ?? "", stderr: env.pm_err_log_path ?? "" },
      external: { pid: item.pid || undefined, status: env.status === "online" ? "running" : "idle", lastOutputAt: lastOutput ? new Date(lastOutput).toISOString() : undefined }
    };
  });
}

export function readOutput(_context, original, options = {}) {
  const tailLines = Math.max(1, Math.min(1000, Math.floor(options.tailLines ?? 300)));
  return [original.stdout, original.stderr].filter(Boolean).map((file) => {
    let fd;
    try {
      fd = fs.openSync(file, "r");
      const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 1024 * 1024));
      fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return `[${path.basename(file)}]\r\n${buffer.toString("utf8").split(/\r?\n/).slice(-tailLines).join("\r\n")}`;
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }).filter(Boolean).join("\r\n");
}
