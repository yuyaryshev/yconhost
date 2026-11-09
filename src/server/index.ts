import http from "node:http";
import { createApp, attachWebSocket } from "./api.js";
import { ConsoleManager } from "./consoleManager.js";
import { ConsoleStore } from "./consoleStore.js";
import { LogStore } from "./logStore.js";
import { ProjectStore } from "./projectStore.js";
import { loadSettings } from "./settings.js";
import { PtyTerminalFactory } from "./terminal.js";
import { FolderService } from "./folderService.js";
import { migrateBuiltinFolders } from "./folderMigration.js";
import { RuntimeClient } from "./runtimeClient.js";

async function main(): Promise<void> {
  const settings = loadSettings();
  const factory = process.env.YCONHOST_TERMINAL_MODE === "direct" ? new PtyTerminalFactory() : new RuntimeClient(settings.dataDir);
  const manager = new ConsoleManager(settings, new LogStore(settings), factory, new ConsoleStore(settings), new ProjectStore(settings));
  await manager.initializeRuntime();
  const folders = new FolderService(manager);
  await migrateBuiltinFolders(folders, settings);
  folders.adoptRegistry();
  await folders.initialize();
  const app = createApp(manager, { folders });
  const server = http.createServer(app);
  const wss = attachWebSocket(server, manager);

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    folders.dispose();
    manager.dispose();
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close();
    // Allow taskkill and native PTY cleanup to finish before PM2's kill timeout.
    setTimeout(() => process.exit(0), 1500);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("message", (message) => { if (message === "shutdown") shutdown(); });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, settings.host, () => {
      console.log(`yconhost listening on http://${settings.host}:${settings.port}`);
      resolve();
    });
  });
}

void main().catch((error) => {
  console.error("[yconhost] Startup failed:", error);
  process.exit(1);
});
