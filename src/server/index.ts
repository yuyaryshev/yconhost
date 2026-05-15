import http from "node:http";
import { createApp, attachWebSocket } from "./api.js";
import { ConsoleManager } from "./consoleManager.js";
import { LogStore } from "./logStore.js";
import { RegistryStore } from "./registryStore.js";
import { loadSettings } from "./settings.js";
import { NodePtyTerminalFactory, VisibleWindowTerminalFactory } from "./terminal.js";
import { createVanillaConsoleController } from "./vanillaConsole.js";

const settings = loadSettings();
const terminalFactory =
  settings.terminalBackend === "visible-window" ? new VisibleWindowTerminalFactory() : new NodePtyTerminalFactory();
const manager = new ConsoleManager(
  settings,
  new LogStore(settings),
  terminalFactory,
  new RegistryStore(settings),
  createVanillaConsoleController()
);
const app = createApp(manager);
const server = http.createServer(app);
attachWebSocket(server, manager);

server.listen(settings.port, settings.host, () => {
  console.log(`yconhost listening on http://${settings.host}:${settings.port}`);
});
