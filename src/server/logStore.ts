import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "./types.js";

export class LogStore {
  private readonly dir: string;

  constructor(private readonly settings: AppSettings) {
    this.dir = path.join(settings.dataDir, "logs");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  append(consoleId: string, chunk: string): void {
    const file = this.file(consoleId);
    fs.appendFileSync(file, chunk, "utf8");
    this.rotate(consoleId);
  }

  read(consoleId: string): string {
    const file = this.file(consoleId);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  }

  readTail(consoleId: string, lineCount: number): string {
    const all = this.read(consoleId);
    const lines = all.split(/\r?\n/);
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines.slice(-lineCount).join("\n");
  }

  private file(consoleId: string): string {
    return path.join(this.dir, `${consoleId}.log`);
  }

  private rotate(consoleId: string): void {
    const file = this.file(consoleId);
    if (!fs.existsSync(file) || fs.statSync(file).size <= this.settings.log.maxBytes) {
      return;
    }

    for (let i = this.settings.log.rotateFiles - 1; i >= 1; i -= 1) {
      const current = `${file}.${i}`;
      const next = `${file}.${i + 1}`;
      if (fs.existsSync(current)) {
        fs.renameSync(current, next);
      }
    }
    fs.renameSync(file, `${file}.1`);
  }
}
