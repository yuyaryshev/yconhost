import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { AppSettings } from "./types.js";

const defaults: AppSettings = {
  host: process.env.YCONHOST_HOST ?? "127.0.0.1",
  port: Number(process.env.YCONHOST_PORT ?? 4000),
  dataDir: process.env.YCONHOST_DATA_DIR ?? path.resolve("data"),
  defaultShell: process.platform === "win32" ? "cmd.exe" : process.env.SHELL ?? "bash",
  log: {
    maxBytes: 5 * 1024 * 1024,
    rotateFiles: 5,
    scrollbackBytes: 1024 * 1024,
    trackerTailChars: 1000
  }
};

function mergeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    ...defaults,
    ...value,
    log: {
      ...defaults.log,
      ...(value.log ?? {})
    }
  };
}

export function loadSettings(filePath = path.resolve("settings.json5")): AppSettings {
  if (!fs.existsSync(filePath)) {
    return defaults;
  }

  const parsed = JSON5.parse(fs.readFileSync(filePath, "utf8")) as Partial<AppSettings>;
  return mergeSettings(parsed);
}
