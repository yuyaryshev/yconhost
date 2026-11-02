import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FolderService } from "./folderService.js";
import type { AppSettings } from "./types.js";

// This is the only legacy-specific step; runtime folder handling has no name checks.
export async function migrateBuiltinFolders(folders: FolderService, settings: AppSettings): Promise<void> {
  const marker = path.join(settings.dataDir, "folder-sources-v1.json");
  if (fs.existsSync(marker)) return;
  const directory = path.resolve(settings.dataDir, "folder-scripts");
  fs.mkdirSync(directory, { recursive: true });
  const codexLibrary = new URL("./folders/codexes.mjs", import.meta.url).href;
  const codexScript = path.join(directory, "codexes.mjs");
  if (!fs.existsSync(codexScript)) fs.writeFileSync(codexScript,
    `import { createCodexFolder } from ${JSON.stringify(codexLibrary)};\nconst config = ${JSON.stringify({ ...settings.codexContexts, defaultCwd: process.cwd() }, null, 2)};\nconst source = createCodexFolder(config);\nexport const { list, defineFields, create, update } = source;\nconst remove = source.delete;\nexport { remove as delete };\n`, "utf8");
  const pm2Script = path.join(directory, "pm2.mjs");
  if (!fs.existsSync(pm2Script)) fs.writeFileSync(pm2Script, `export { list, readOutput } from ${JSON.stringify(new URL("./folders/pm2.mjs", import.meta.url).href)};\n`, "utf8");
  // Register missing sources even if the file is unavailable; startup list reports the error without deleting slots.
  const registry = folders.store.listManagedProjects();
  for (const config of [
    { name: settings.codexContexts.projectName, scriptPath: codexScript, intervalSeconds: 60 },
    { name: "pm2", scriptPath: pm2Script, intervalSeconds: 2 }
  ]) {
    const old = registry.find((item) => item.name.toLowerCase() === config.name.toLowerCase());
    const now = new Date().toISOString();
    folders.store.saveProject({ ...old, ...config, type: "scripted", gatherErrors: old?.gatherErrors ?? false, createdAt: old?.createdAt ?? now, updatedAt: now });
  }
  fs.writeFileSync(marker, JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), library: fileURLToPath(codexLibrary) }), "utf8");
}
