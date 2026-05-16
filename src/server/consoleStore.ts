import fs from "node:fs";
import path from "node:path";
import type { AppSettings, ConsoleDefinition, ConsoleRecord } from "./types.js";

export class ConsoleStore {
  private readonly file: string;

  constructor(settings: AppSettings) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    this.file = path.join(settings.dataDir, "consoles.json");
  }

  load(): ConsoleDefinition[] {
    if (!fs.existsSync(this.file)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as ConsoleDefinition[];
  }

  save(records: ConsoleRecord[]): void {
    const definitions: ConsoleDefinition[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      project: record.project,
      projectPath: record.projectPath,
      cwd: record.cwd,
      command: record.command,
      shell: record.shell,
      args: record.args,
      ansiParserEnabled: record.ansiParserEnabled
    }));
    fs.writeFileSync(this.file, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");
  }
}
