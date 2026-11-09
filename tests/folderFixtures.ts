import fs from "node:fs";
import path from "node:path";
import type { FolderService } from "../src/server/folderService.js";
import type { AppSettings } from "../src/server/types.js";

export async function configureCodexFixture(folders: FolderService, settings: AppSettings) {
  const scriptPath = path.join(settings.dataDir, "agent-folder.mjs");
  const library = new URL("../src/server/folders/codexes.mjs", import.meta.url).href;
  fs.writeFileSync(scriptPath, `import { createCodexFolder } from ${JSON.stringify(library)};\nconst source = createCodexFolder(${JSON.stringify({ ...settings.codexContexts, defaultCwd: settings.dataDir })});\nexport const { list, defineFields, create, update, getVariables } = source;\nconst remove = source.delete;\nexport { remove as delete };\n`);
  return folders.configure({ name: settings.codexContexts.projectName, type: "scripted", scriptPath, intervalSeconds: 0, gatherErrors: false, confirmed: true });
}
