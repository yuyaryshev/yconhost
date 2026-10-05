import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ConsoleRecord, ConsoleSessionState, ConsoleSnapshot } from "./types.js";

type Pm2Process = {
  name?: string;
  pid?: number;
  pm_id?: number;
  pm2_env?: {
    status?: string;
    pm_cwd?: string;
    pm_exec_path?: string;
    args?: string[] | string;
    created_at?: number;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
  };
};

export class Pm2Monitor {
  list(): ConsoleRecord[] {
    return this.readProcesses().map((processInfo) => this.toRecord(processInfo));
  }

  get(id: string): ConsoleSnapshot | undefined {
    const processInfo = this.readProcesses().find((item) => pm2ConsoleId(item) === id);
    if (!processInfo) return undefined;
    const record = this.toRecord(processInfo);
    return { ...record, outputTail: this.readOutput(id), errorMatches: [], cards: [] };
  }

  getState(id: string, tailLines = 8): ConsoleSessionState | undefined {
    const processInfo = this.readProcesses().find((item) => pm2ConsoleId(item) === id);
    if (!processInfo) return undefined;
    const record = this.toRecord(processInfo);
    const tail = this.readOutput(id, tailLines);
    return { ...record, lastOutputAt: record.updatedAt, tail, tailLines: splitTailLines(tail) };
  }

  readOutput(id: string, tailLines?: number): string {
    const processInfo = this.readProcesses().find((item) => pm2ConsoleId(item) === id);
    if (!processInfo) {
      throw new Error(`Console ${id} not found`);
    }
    const output = [processInfo.pm2_env?.pm_out_log_path, processInfo.pm2_env?.pm_err_log_path]
      .filter((file): file is string => Boolean(file))
      .map((file) => readTail(file, tailLines ?? 300))
      .filter(Boolean)
      .join("\r\n");
    return output || `[yconhost] No PM2 log output for ${processInfo.name ?? id}\r\n`;
  }

  has(id: string): boolean {
    return id.startsWith("pm2:");
  }

  private readProcesses(): Pm2Process[] {
    try {
      const output =
        process.platform === "win32"
          ? execFileSync("cmd.exe", ["/d", "/s", "/c", "pm2 jlist"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
          : execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 5000 });
      return JSON.parse(output) as Pm2Process[];
    } catch {
      return [];
    }
  }

  private toRecord(processInfo: Pm2Process): ConsoleRecord {
    const env = processInfo.pm2_env ?? {};
    const args = Array.isArray(env.args) ? env.args : env.args ? [env.args] : [];
    const command = [env.pm_exec_path, ...args].filter(Boolean).join(" ") || processInfo.name || "pm2 process";
    const createdAt = env.created_at ? new Date(env.created_at).toISOString() : new Date(0).toISOString();
    return {
      id: pm2ConsoleId(processInfo),
      name: processInfo.name ?? `pm2-${processInfo.pm_id ?? "process"}`,
      project: "pm2",
      cwd: env.pm_cwd ?? process.cwd(),
      command,
      shell: "pm2",
      args,
      pid: processInfo.pid,
      status: env.status === "online" ? "running" : "idle",
      ansiParserEnabled: false,
      errorCount: 0,
      unseenErrorCount: 0,
      createdAt,
      updatedAt: new Date().toISOString(),
      readonly: true,
      source: "pm2"
    };
  }
}

function splitTailLines(tail: string): string[] {
  if (!tail) return [];
  const lines = tail.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function pm2ConsoleId(processInfo: Pm2Process): string {
  return `pm2:${processInfo.pm_id ?? processInfo.name ?? "unknown"}`;
}

function readTail(filePath: string, tailLines: number): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const label = path.basename(filePath);
    return [`[${label}]`, ...lines.slice(-tailLines)].join("\r\n");
  } catch {
    return "";
  }
}
