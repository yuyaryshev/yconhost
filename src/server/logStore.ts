import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "./types.js";

export class LogStore {
  private readonly dir: string;
  private readonly sizes = new Map<string, number>();
  private readonly buffers = new Map<string, string>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly settings: AppSettings) {
    this.dir = path.join(settings.dataDir, "logs");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  append(consoleId: string, chunk: string): void {
    this.buffers.set(consoleId, `${this.buffers.get(consoleId) ?? ""}${chunk}`);
    if (!this.flushTimers.has(consoleId)) {
      this.flushTimers.set(consoleId, setTimeout(() => this.flush(consoleId), 100));
    }
  }

  flush(consoleId: string): void {
    const timer = this.flushTimers.get(consoleId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(consoleId);
    }
    const chunk = this.buffers.get(consoleId);
    if (!chunk) return;
    this.buffers.delete(consoleId);
    const file = this.file(consoleId);
    fs.appendFileSync(file, chunk, "utf8");
    const currentSize = this.sizes.get(consoleId) ?? (fs.existsSync(file) ? fs.statSync(file).size - Buffer.byteLength(chunk, "utf8") : 0);
    const nextSize = currentSize + Buffer.byteLength(chunk, "utf8");
    this.sizes.set(consoleId, nextSize);
    if (nextSize > this.settings.log.maxBytes) {
      this.rotate(consoleId);
      this.sizes.set(consoleId, 0);
    }
  }

  read(consoleId: string): string {
    this.flush(consoleId);
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
