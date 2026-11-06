import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArray<T>(text: string): T[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error("Expected a JSON array");
  return value as T[];
}

function atomicWrite(file: string, text: string): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx");
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function readJsonArray<T>(file: string): T[] {
  const backup = `${file}.bak`;
  if (!fs.existsSync(file) && !fs.existsSync(backup)) return [];
  try {
    return parseArray<T>(fs.readFileSync(file, "utf8"));
  } catch (primaryError) {
    let text: string;
    let rows: T[];
    try {
      text = fs.readFileSync(backup, "utf8");
      rows = parseArray<T>(text);
    } catch {
      throw new Error(`Cannot read state ${file}: ${String(primaryError)}. No valid backup at ${backup}.`);
    }
    const corrupt = `${file}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
    if (fs.existsSync(file)) fs.copyFileSync(file, corrupt);
    atomicWrite(file, text);
    console.warn(`[yconhost] Recovered ${file} from ${backup}; original preserved at ${corrupt}`);
    return rows;
  }
}

export function writeJsonArray(file: string, rows: readonly unknown[]): void {
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  const backup = `${file}.bak`;
  // Preserve the previous valid state before replacing it; never truncate the live file.
  if (fs.existsSync(file)) {
    readJsonArray(file);
    atomicWrite(backup, fs.readFileSync(file, "utf8"));
  } else if (!fs.existsSync(backup)) {
    atomicWrite(backup, text);
  }
  atomicWrite(file, text);
}
