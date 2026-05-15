import fs from "node:fs";
import path from "node:path";
import type { AppSettings, ConsoleRecord } from "./types.js";

export class RegistryStore {
  private readonly file: string;

  constructor(settings: AppSettings) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    this.file = path.join(settings.dataDir, "consoles.json");
  }

  load(): ConsoleRecord[] {
    if (!fs.existsSync(this.file)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as ConsoleRecord[];
    return parsed.map((record) => ({
      ...record,
      pid: undefined,
      status: record.status === "exited" ? "exited" : "detached",
      attached: false,
      updatedAt: new Date().toISOString()
    }));
  }

  save(records: ConsoleRecord[]): void {
    const safeRecords = records.map((record) => ({
      ...record,
      attached: false,
      pid: record.attached ? record.pid : undefined
    }));
    fs.writeFileSync(this.file, `${JSON.stringify(safeRecords, null, 2)}\n`, "utf8");
  }
}
