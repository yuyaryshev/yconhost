import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readJsonArray, writeJsonArray } from "../src/server/jsonStore.js";

let directory: string;
let file: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-json-")); file = path.join(directory, "state.json"); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

it("writes flushed complete snapshots with a previous valid backup and no temporary leftovers", () => {
  expect(readJsonArray(file)).toEqual([]);
  const flush = vi.spyOn(fs, "fsyncSync");
  writeJsonArray(file, [{ id: "one" }]);
  expect(readJsonArray(file)).toEqual([{ id: "one" }]);
  expect(readJsonArray(`${file}.bak`)).toEqual([{ id: "one" }]);
  writeJsonArray(file, [{ id: "two" }]);
  expect(readJsonArray(file)).toEqual([{ id: "two" }]);
  expect(readJsonArray(`${file}.bak`)).toEqual([{ id: "one" }]);
  expect(flush).toHaveBeenCalledTimes(4);
  expect(fs.readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(false);
});

it.each(["\0".repeat(100), "[partial", "{}"])("restores a damaged snapshot without losing its original bytes: %j", (damaged) => {
  writeJsonArray(file, [{ name: "Saved" }]);
  fs.writeFileSync(file, damaged);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(readJsonArray(file)).toEqual([{ name: "Saved" }]);
  const corrupt = fs.readdirSync(directory).find((name) => name.includes(".corrupt-"));
  expect(corrupt).toBeTruthy();
  expect(fs.readFileSync(path.join(directory, corrupt!), "utf8")).toBe(damaged);
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([{ name: "Saved" }]);
  expect(warning).toHaveBeenCalledOnce();
});

it("recovers a missing primary from its backup", () => {
  writeJsonArray(file, ["Saved"]);
  fs.unlinkSync(file);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(readJsonArray(file)).toEqual(["Saved"]);
  expect(fs.existsSync(file)).toBe(true);
});

it("fails explicitly when neither snapshot is valid, preserving both files", () => {
  fs.writeFileSync(file, "\0\0");
  fs.writeFileSync(`${file}.bak`, "[broken");
  expect(() => readJsonArray(file)).toThrow("No valid backup");
  expect(() => writeJsonArray(file, [])).toThrow("No valid backup");
  expect(fs.readFileSync(file, "utf8")).toBe("\0\0");
  expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("[broken");
});

it("does not truncate the current state when a replacement fails", () => {
  writeJsonArray(file, ["Saved"]);
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    if (target === file) throw new Error("rename failed");
    rename(source, target);
  });
  expect(() => writeJsonArray(file, ["Not committed"])).toThrow("rename failed");
  expect(readJsonArray(file)).toEqual(["Saved"]);
  expect(readJsonArray(`${file}.bak`)).toEqual(["Saved"]);
  expect(fs.readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(false);
});
