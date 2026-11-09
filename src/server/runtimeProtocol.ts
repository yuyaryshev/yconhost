import crypto from "node:crypto";
import path from "node:path";
import type { ConsoleCreateRequest, NativeWindowState } from "./types.js";

export const runtimeVersion = 1;
export const maxRuntimeFrame = 16 * 1024 * 1024;
export const maxRuntimeBacklog = 4 * 1024 * 1024;
export function runtimeAddress(dataDir: string): string {
  const key = crypto.createHash("sha256").update(path.resolve(dataDir).toLowerCase()).digest("hex").slice(0, 24);
  return process.platform === "win32" ? `\\\\.\\pipe\\yconhost-terminal-${key}` : path.join(path.resolve(dataDir), `terminal-${key}.sock`);
}
export function runtimeTokenPath(dataDir: string): string { return path.join(dataDir, "terminal-host-token.json"); }

export interface RuntimeRun {
  consoleId: string;
  runId: string;
  definition: ConsoleCreateRequest;
  launch: string;
  pid?: number;
  status: "starting" | "running" | "exited";
  startedAt: string;
  lastInputAt?: string;
  lastOutputAt?: string;
  lastAccessedAt?: string;
  exitCode?: number;
  nativeCli?: NativeWindowState;
  sequence: number;
}
export interface TerminalScreen {
  output: string;
  cols: number;
  rows: number;
  runId?: string;
  sequence?: number;
}
export interface OutputPosition { runId?: string; sequence?: number; resync?: boolean }
export type RuntimeEvent = { event: "output"; consoleId: string; runId: string; sequence: number; data: string; at: string } |
  { event: "state"; run: RuntimeRun };
export interface RuntimeRequest { id: string; method: string; args?: any; expiresAt: number }

export function validConsoleId(value: unknown): value is string { return typeof value === "string" && /^[\w-]{1,160}$/.test(value); }
