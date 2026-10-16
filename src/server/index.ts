import http from "node:http";
import { createApp, attachWebSocket } from "./api.js";
import { ConsoleManager } from "./consoleManager.js";
import { ConsoleStore } from "./consoleStore.js";
import { LogStore } from "./logStore.js";
import { ProjectStore } from "./projectStore.js";
import { loadSettings } from "./settings.js";
import { PtyTerminalFactory } from "./terminal.js";

const settings = loadSettings();
const manager = new ConsoleManager(settings, new LogStore(settings), new PtyTerminalFactory(), new ConsoleStore(settings), new ProjectStore(settings));
const app = createApp(manager);
const server = http.createServer(app);
const wss = attachWebSocket(server, manager);

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
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

server.listen(settings.port, settings.host, () => {
  console.log(`yconhost listening on http://${settings.host}:${settings.port}`);
});
