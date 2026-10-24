import type { TerminalOptions } from "./terminal.js";
import type { NativeWindowState } from "./types.js";

export interface NativeStartRequest {
  type: "start";
  shell: string;
  args: string[];
  options: TerminalOptions;
  runtime: string;
  pipeId: string;
}

export type NativeWorkerRequest = NativeStartRequest
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "kill" }
  | { type: "native"; id: number; visible?: boolean };

export type NativeWorkerResponse = { type: "ready"; pid: number }
  | { type: "data"; data: string }
  | { type: "native"; state: NativeWindowState }
  | { type: "reply"; id: number; state: NativeWindowState }
  | { type: "reply"; id: number; error: string }
  | { type: "exit"; exitCode: number }
  | { type: "failure"; error: string };
