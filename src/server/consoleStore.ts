import fs from "node:fs";
import path from "node:path";
import { readJsonArray, writeJsonArray } from "./jsonStore.js";
import type { AppSettings, ConsoleDefinition, ConsoleRecord } from "./types.js";

export class ConsoleStore {
  private readonly file: string;

  constructor(settings: AppSettings) {
    fs.mkdirSync(settings.dataDir, { recursive: true });
    this.file = path.join(settings.dataDir, "consoles.json");
  }

  load(): ConsoleDefinition[] {
    return readJsonArray<ConsoleDefinition>(this.file);
  }

  save(records: ConsoleRecord[]): void {
    const definitions: ConsoleDefinition[] = records.filter((record) => !record.readonly).map((record) => ({
      folderId: record.folderId,
      sourceKey: record.sourceKey,
      sourceValues: record.sourceValues,
      description: record.description,
      pinned_text: record.pinned_text,
      pinnedVariables: record.pinnedVariables,
      orphaned: record.orphaned,
      id: record.id,
      lastStartedAt: record.lastStartedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      name: record.name,
      project: record.project,
      projectPath: record.projectPath,
      cwd: record.cwd,
      command: record.command,
      shell: record.shell,
      args: record.args,
      noRun: record.noRun,
      autoStartOnOpen: record.autoStartOnOpen,
      status: record.status,
      lastInputAt: record.lastInputAt,
      lastOutputAt: record.lastOutputAt,
      lastAccessedAt: record.lastAccessedAt,
      persistent: record.persistent,
      background: record.background,
      backgroundColor: record.backgroundColor,
      ansiParserEnabled: record.ansiParserEnabled,
      gatherErrors: record.gatherErrorsOverride,
      readCardHashes: record.readCardHashes
    }));
    writeJsonArray(this.file, definitions);
  }
}
