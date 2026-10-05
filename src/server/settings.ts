import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { AppSettings } from "./types.js";

const defaults: AppSettings = {
  host: process.env.YCONHOST_HOST ?? "127.0.0.1",
  port: Number(process.env.YCONHOST_PORT ?? 4000),
  dataDir: process.env.YCONHOST_DATA_DIR ?? path.resolve("data"),
  defaultShell: process.platform === "win32" ? "cmd.exe" : process.env.SHELL ?? "bash",
  terminal: {
    cols: 160,
    rows: 40,
    scrollback: 0
  },
  log: {
    maxBytes: 10 * 1024 * 1024,
    rotateFiles: 3,
    scrollbackBytes: 1024 * 1024
  },
  cards: {
    maxPerConsole: 500,
    scanTailBytes: 10 * 1024 * 1024
  },
  codexContexts: {
    projectName: "codexes",
    contextsPath: "D:\\b\\InfoVault\\Codex contexts.md",
    weztermPresetsPath: "D:\\ProgsReady\\WezTerm\\yy_wezterm_codexes.lua"
  },
  temporaryConsoles: {
    ttlHours: 4,
    cleanupIntervalMs: 60_000
  }
};

function mergeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    ...defaults,
    ...value,
    terminal: {
      ...defaults.terminal,
      ...(value.terminal ?? {})
    },
    log: {
      ...defaults.log,
      ...(value.log ?? {})
    },
    cards: {
      ...defaults.cards,
      ...(value.cards ?? {})
    },
    codexContexts: {
      ...defaults.codexContexts,
      ...(value.codexContexts ?? {})
    },
    temporaryConsoles: {
      ...defaults.temporaryConsoles,
      ...(value.temporaryConsoles ?? {})
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

export function saveSettings(settings: AppSettings, filePath = path.resolve("settings.json5")): AppSettings {
  const merged = mergeSettings(settings);
  fs.writeFileSync(filePath, JSON5.stringify(merged, null, 2), "utf8");
  return merged;
}
