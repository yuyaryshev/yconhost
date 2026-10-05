import fs from "node:fs";
import path from "node:path";
import type { ConsoleRegisterRequest } from "./types.js";

export interface CodexContextPreset {
  id: string;
  name: string;
  background: string;
  command: string;
  cwd: string;
}

export interface CodexContextLoadOptions {
  project: string;
  contextsPath: string;
  weztermPresetsPath?: string;
  defaultCwd?: string;
}

export function loadCodexContextPresets(options: CodexContextLoadOptions): ConsoleRegisterRequest[] {
  const seenCommands = new Set<string>();
  const presets: CodexContextPreset[] = [];

  for (const preset of loadWeztermBuiltInPresets(options.weztermPresetsPath, options.defaultCwd)) {
    appendPreset(presets, seenCommands, preset);
  }
  for (const preset of loadMarkdownPresets(options.contextsPath, options.defaultCwd)) {
    appendPreset(presets, seenCommands, preset);
  }

  return presets.map((preset) => ({
    project: options.project,
    name: preset.name,
    cwd: preset.cwd,
    command: preset.command,
    shell: process.platform === "win32" ? "cmd.exe" : undefined,
    noRun: true,
    background: preset.background,
    ansiParserEnabled: true,
    start: false
  }));
}

function loadWeztermBuiltInPresets(filePath: string | undefined, defaultCwd?: string): CodexContextPreset[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const block = text.match(/local\s+built_in_presets\s*=\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!block) return [];

  const presets: CodexContextPreset[] = [];
  const pattern = /\{\s*id\s*=\s*'([^']+)'\s*,\s*name\s*=\s*'([^']+)'\s*,\s*background\s*=\s*'(#[0-9a-fA-F]{6})'\s*,\s*command\s*=\s*'([^']+)'\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block))) {
    const command = unescapeLuaSingleQuotedString(match[4]);
    presets.push({
      id: match[1],
      name: match[2],
      background: match[3].toLowerCase(),
      command,
      cwd: extractCwd(command, defaultCwd)
    });
  }
  return presets;
}

function loadMarkdownPresets(filePath: string, defaultCwd?: string): CodexContextPreset[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const presets: CodexContextPreset[] = [];
  let title: string | undefined;
  let background: string | undefined;
  let code: string[] = [];
  let inCodeBlock = false;
  let index = 0;

  const flush = () => {
    const preset = buildMarkdownPreset(title, background, code, index + 1, defaultCwd);
    if (!preset) return;
    index += 1;
    presets.push(preset);
  };

  for (const line of lines) {
    const heading = line.match(/^#\s+(.+?)\s*$/)?.[1];
    if (heading) {
      flush();
      title = heading;
      background = undefined;
      code = [];
      inCodeBlock = false;
      continue;
    }
    if (line.match(/^```/)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      code.push(line);
      continue;
    }
    const color = line.match(/^Color:\s*`?(#[0-9a-fA-F]{6})`?/)?.[1];
    if (color) background = color.toLowerCase();
  }
  flush();
  return presets;
}

function buildMarkdownPreset(title: string | undefined, background: string | undefined, code: string[], index: number, defaultCwd?: string): CodexContextPreset | undefined {
  if (!title || !background) return undefined;
  const codexLine = code.findIndex((line) => isCodexCommand(line));
  if (codexLine < 0) return undefined;

  const commandParts: string[] = [];
  for (const line of code.slice(0, codexLine)) {
    const trimmed = line.trim();
    if (trimmed && isCommandPrefix(trimmed) && !isCodexHomeAssignment(trimmed)) {
      commandParts.push(trimmed);
    }
  }
  commandParts.push(addBypassSafetyY(useYcodex(code[codexLine].trim())));
  const command = commandParts.join(" & ");

  return {
    id: `context-${String(index).padStart(3, "0")}`,
    name: title.trim(),
    background,
    command,
    cwd: extractCwd(command, defaultCwd)
  };
}

function appendPreset(presets: CodexContextPreset[], seenCommands: Set<string>, preset: CodexContextPreset): void {
  if (seenCommands.has(preset.command)) return;
  seenCommands.add(preset.command);
  presets.push(preset);
}

function isCodexCommand(line: string): boolean {
  const lower = line.toLowerCase();
  return /^\s*ycodex\s/.test(lower) || /&&\s*ycodex\s/.test(lower) || /^\s*codex\s/.test(lower) || /&&\s*codex\s/.test(lower);
}

function useYcodex(command: string): string {
  const lower = command.toLowerCase();
  if (/^\s*ycodex\s/.test(lower) || /&&\s*ycodex\s/.test(lower)) return command;
  return command.replace(/([cC][oO][dD][eE][xX])(\s+)/, "ycodex$2");
}

function addBypassSafetyY(command: string): string {
  if (command.toLowerCase().includes("--bypass-safety-y")) return command;
  return command.replace(/([yY][cC][oO][dD][eE][xX])(\s+)/, "$1 --bypass-safety-y$2");
}

function isCommandPrefix(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return lower.startsWith("cls") || lower.startsWith("set ") || lower.startsWith("cd ") || lower.startsWith("title ");
}

function isCodexHomeAssignment(command: string): boolean {
  const lower = command.trim().toLowerCase();
  return /^set\s+"?codex_home=/.test(lower) || /^set\s+"?ycodex_home=/.test(lower);
}

function extractCwd(command: string, defaultCwd = process.cwd()): string {
  const matches = [...command.matchAll(/\bcd\s+\/d\s+(.+?)(?=\s*(?:&&|&|$))/gi)];
  const raw = matches.at(-1)?.[1]?.trim();
  if (!raw) return defaultCwd;
  return path.resolve(raw.replace(/^"(.+)"$/, "$1"));
}

function unescapeLuaSingleQuotedString(value: string): string {
  return value.replace(/\\\\/g, "\\").replace(/\\'/g, "'");
}
