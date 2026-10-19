import { execFile } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { Pm2Monitor } from "../src/server/pm2Monitor.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("returns immediately during a PM2 refresh and retains its last snapshot on failure", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const monitor = new Pm2Monitor();
  expect(monitor.list()).toEqual([]);
  expect(monitor.list()).toEqual([]);
  expect(execFile).toHaveBeenCalledTimes(1);
  const finish = vi.mocked(execFile).mock.calls[0][3] as (error: Error | null, output: string) => void;
  finish(null, '>>>> PM2 version warning\n[{"pm_id":1,"name":"service","pid":123,"pm2_env":{"status":"online"}}]');
  expect(monitor.list()).toEqual([expect.objectContaining({ id: "pm2:1", name: "service", status: "running" })]);
  expect(execFile).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(Date.now() + 2001));
  expect(monitor.list()).toHaveLength(1);
  const fail = vi.mocked(execFile).mock.calls[1][3] as (error: Error | null, output: string) => void;
  fail(new Error("PM2 unavailable"), "");
  expect(monitor.list()).toHaveLength(1);
});
