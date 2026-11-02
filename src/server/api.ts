import express from "express";
import type { Server } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { ConsoleManager } from "./consoleManager.js";
import { FolderService } from "./folderService.js";
import { saveSettings } from "./settings.js";

export function createApp(manager: ConsoleManager, options: { folders?: FolderService } = {}): express.Express {
  const app = express();
  const folders = options.folders ?? new FolderService(manager);
  app.locals.folders = folders;
  app.use(express.json({ limit: "1mb" }));
  const manualConsole = async (body: any, register = false) => {
    await folders.ensureManual(body.project ?? "Default");
    return register ? manager.registerConsole(body) : manager.create(body);
  };
  const addProject = (body: any) => folders.configure({ ...body, type: body.type ?? "manual" });

  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });
  app.get("/api/consoles", (req, res) => { res.json({ consoles: manager.list(req.query.project?.toString()) }); });
  app.get("/api/projects", (_req, res) => { res.json({ projects: manager.listProjects() }); });
  app.post("/api/projects", route(respond((req) => addProject(req.body))));
  app.get("/api/projects/:project/settings", route(respond((req) => folders.get(param(req, "project")))));
  app.put("/api/projects/:project/settings", route(respond((req) => folders.configure({ ...req.body, name: folders.get(param(req, "project")).name }))));
  app.post("/api/projects/:project/list", route(respond((req) => folders.listFolder(param(req, "project"), true))));
  app.get("/api/projects/:project/fields", route(respond((req) => folders.entry(param(req, "project")))));
  app.post("/api/projects/:project/entries", route(respond((req) => folders.createEntry(param(req, "project"), req.body.values ?? req.body))));
  app.get("/api/consoles/:id/entry", route(respond((req) => folders.entry(manager.get(param(req, "id")).project, param(req, "id")))));
  app.put("/api/consoles/:id/entry", route(respond((req) => folders.updateEntry(param(req, "id"), req.body.values ?? req.body, req.body.revision))));
  app.delete("/api/consoles/:id/entry", route(respond(async (req) => { await folders.deleteEntry(param(req, "id"), req.body.confirmed === true); return { ok: true }; })));

  app.get("/api/recent-projects", (_req, res) => { res.json({ projects: manager.recentProjects() }); });
  app.delete("/api/recent-projects", route(respond((req) => ({ projects: manager.removeRecentProject(String(req.body.projectPath ?? "")) }))));
  app.get("/api/settings", (_req, res) => { res.json({ settings: manager.getSettings() }); });
  app.post("/api/settings", route(respond((req) => ({ settings: manager.updateSettings(saveSettings(req.body.settings ?? req.body)) }))));
  app.post("/api/consoles", route(respond((req) => manualConsole(req.body))));
  app.post("/api/batch", route(respond(async (req) => {
    if (typeof req.body.projectPath !== "string" || !req.body.projectPath) throw new Error("projectPath is required");
    const name = path.basename(path.resolve(req.body.projectPath));
    const previous = new Set(manager.list(name).map((item) => item.id));
    await folders.configure({ name, type: "my_wins", projectPath: req.body.projectPath, confirmed: req.body.confirmed === true });
    manager.createBatch(req.body.projectPath, req.body.fileName, { startNew: false });
    for (const record of manager.list(name)) if (!previous.has(record.id) && !record.noRun && !record.orphaned) manager.start(record.id);
    return manager.list(name);
  })));
  app.get("/api/consoles/:id", route(respond((req) => folders.snapshot(param(req, "id")))));
  app.get("/api/consoles/:id/output", route(respond(async (req) => ({ output: await folders.readOutput(param(req, "id"), req.query.tailLines ? Number(req.query.tailLines) : undefined) }))));
  app.get("/api/consoles/:id/state", route(respond((req) => folders.sessionState(param(req, "id"), req.query.tailLines ? Number(req.query.tailLines) : undefined))));
  app.post("/api/consoles/:id/input", route(respond((req) => { manager.write(param(req, "id"), String(req.body.data ?? "")); return { ok: true }; })));
  app.post("/api/consoles/:id/signal", route(respond((req) => { manager.signal(param(req, "id"), String(req.body.signal ?? "ctrl+c").toLowerCase()); return { ok: true }; })));
  app.post("/api/consoles/:id/restart", route(respond((req) => manager.restart(param(req, "id")))));
  app.post("/api/consoles/:id/start", route(respond((req) => manager.start(param(req, "id")))));
  app.post("/api/consoles/:id/name", route(respond((req) => folders.renameEntry(param(req, "id"), String(req.body.name ?? "")))));
  app.post("/api/consoles/:id/read", route(respond((req) => manager.markRead(param(req, "id")))));
  app.post("/api/consoles/:id/gather-errors", route(respond((req) => manager.setGatherErrors(param(req, "id"), req.body.enabled))));
  app.get("/api/consoles/:id/native", route(respond((req) => manager.nativeWindow(param(req, "id")))));
  app.post("/api/consoles/:id/native", route(respond((req) => {
    if (typeof req.body.visible !== "boolean") throw new Error("visible must be a boolean");
    return manager.nativeWindow(param(req, "id"), req.body.visible);
  })));
  app.delete("/api/consoles/:id", route(respond((req) => { manager.kill(param(req, "id")); return { ok: true }; })));
  app.post("/api/projects/:project/restart", route(respond((req) => manager.restartProject(param(req, "project")))));
  app.post("/api/projects/:project/restart-except-no-run", route(respond((req) => manager.restartProjectExceptNoRun(param(req, "project")))));
  app.post("/api/projects/:project/stop", route(respond((req) => { manager.stopProject(param(req, "project")); return { ok: true }; })));
  app.post("/api/projects/:project/start", route(respond((req) => manager.startProject(param(req, "project")))));
  app.post("/api/projects/:project/reload", route(respond((req) => folders.listFolder(param(req, "project"), true))));
  app.post("/api/projects/:project/read", route(respond((req) => { manager.markProjectRead(param(req, "project")); return { ok: true }; })));
  app.post("/api/projects/:project/gather-errors", route(respond((req) => { folders.setGatherErrors(param(req, "project"), req.body.enabled); return manager.listProjects().find((item) => item.name === param(req, "project")); })));
  app.delete("/api/projects/:project", route(respond((req) => { folders.close(param(req, "project")); return { ok: true }; })));

  const string = { type: "string" };
  const boolean = { type: "boolean" };
  const values = { type: "object", additionalProperties: string };
  const configProperties = { name: string, type: { type: "string", enum: ["manual", "my_wins", "scripted"] }, scriptPath: string, projectPath: string, intervalSeconds: { type: "number", minimum: 0, maximum: 86400 }, gatherErrors: boolean, closeRemoves: boolean, confirmed: boolean };
  const consoleProperties = { name: string, project: string, cwd: string, command: string, shell: string, args: { type: "array", items: string }, noRun: boolean, persistent: boolean, ansiParserEnabled: boolean };
  const descriptors: Array<{ name: string; description: string; properties: object; required?: string[]; run: (args: any) => unknown }> = [
    { name: "list_consoles", description: "List cached console slots without starting or rereading sources.", properties: { project: string }, run: (a) => manager.list(a.project) },
    { name: "list_projects", description: "List folders, including empty folders, types, capabilities and source errors.", properties: {}, run: () => manager.listProjects() },
    { name: "create_project", description: "Create a folder. manual does not require or write mywins.json. scripted requires a unique absolute local JS path exporting list(context). No processes are started.", properties: configProperties, required: ["name"], run: addProject },
    { name: "get_folder_settings", description: "Read folder type, source path, update interval and capabilities.", properties: { project: string }, required: ["project"], run: (a) => folders.get(a.project) },
    { name: "update_folder_settings", description: "Update settings. Changing type or source recreates the folder under the same name and stops owned sessions; requires confirmed=true. Never deletes external source files or PM2 processes.", properties: { ...configProperties, project: string }, required: ["project", "type"], run: (a) => folders.configure({ ...a, name: folders.get(a.project).name }) },
    { name: "list_folder", description: "Reread the local script and call list(context), reconciling idle slots without launching processes. Retains the last good list on failure.", properties: { project: string }, required: ["project"], run: (a) => folders.listFolder(a.project, true) },
    { name: "get_folder_fields", description: "Read shared create/edit fields and original values. Types: string and color; color values are HEX/RGB or STD_* strings. Omitted defineFields defaults to name and description.", properties: { project: string, id: string }, required: ["project"], run: (a) => folders.entry(a.project, a.id) },
    { name: "create_folder_entry", description: "Create in the folder source using string values, then call list. Only available when the source exports create; never bypasses the source.", properties: { project: string, values }, required: ["project", "values"], run: (a) => folders.createEntry(a.project, a.values) },
    { name: "update_folder_entry", description: "Edit a source entry via update(original, values), then list. Pass all form values and the revision from get_folder_fields to detect concurrent edits. Preserves console ID/history when update returns its new key. Codex forbids changing name and session_id together.", properties: { id: string, values, revision: string }, required: ["id", "values"], run: (a) => folders.updateEntry(a.id, a.values, a.revision) },
    { name: "delete_folder_entry", description: "Delete/disable an entry in its source, stopping its owned process only after source success. Requires confirmed=true. Codex marks H1 with DELETED; PM2 is readonly.", properties: { id: string, confirmed: boolean }, required: ["id", "confirmed"], run: async (a) => { await folders.deleteEntry(a.id, a.confirmed === true); return { ok: true }; } },
    { name: "get_console_state", description: "Read session status, last input/output timestamps and the last few output lines. tailLines defaults to 8.", properties: { id: string, tailLines: { type: "number" } }, required: ["id"], run: (a) => folders.sessionState(a.id, a.tailLines) },
    { name: "read_console", description: "Read output of an owned or external readonly console.", properties: { id: string, tailLines: { type: "number" } }, required: ["id"], run: (a) => folders.readOutput(a.id, a.tailLines) },
    { name: "write_console", description: "Send raw input to a running writable console.", properties: { id: string, data: string }, required: ["id", "data"], run: (a) => { manager.write(a.id, a.data); return "ok"; } },
    { name: "send_console_command", description: "Send a command line to an existing running console and return immediately without waiting for completion.", properties: { id: string, command: string }, required: ["id", "command"], run: (a) => manager.runCommand(a.id, a.command, { wait: false }) },
    { name: "run_console_command", description: "Run a command line in an existing running console, wait for its completion marker and return captured output and exitCode. timeoutMs defaults to 30000.", properties: { id: string, command: string, timeoutMs: { type: "number" } }, required: ["id", "command"], run: (a) => manager.runCommand(a.id, a.command, { wait: true, timeoutMs: a.timeoutMs }) },
    { name: "create_console", description: "Create and start a manual console. Temporary by default, expires after idle TTL; pass persistent=true to retain it. Use create_folder_entry for source-controlled folders.", properties: consoleProperties, run: (a) => manualConsole({ ...a, persistent: a.persistent === true }) },
    { name: "register_console", description: "Register a slot in a manual project, idle and temporary by default. start=true launches; persistent=true retains it. Does not use mywins.json.", properties: { ...consoleProperties, start: boolean }, required: ["project"], run: (a) => manualConsole({ ...a, persistent: a.persistent === true }, true) },
    { name: "close_console", description: "Close a console process, not its source entry. Folder policy decides whether its slot remains; external consoles are readonly.", properties: { id: string }, required: ["id"], run: (a) => { manager.kill(a.id); return "ok"; } },
    { name: "restart_console", description: "Restart an owned console with its latest launch definition.", properties: { id: string }, required: ["id"], run: (a) => manager.restart(a.id) },
    { name: "start_console", description: "Start an idle owned console.", properties: { id: string }, required: ["id"], run: (a) => manager.start(a.id) },
    { name: "stop_console", description: "Stop an owned console, retaining its slot.", properties: { id: string }, required: ["id"], run: (a) => { manager.stop(a.id); return "ok"; } },
    { name: "restart_project_except_no_run", description: "Restart project consoles excluding no_run entries; external entries cannot be controlled.", properties: { project: string }, required: ["project"], run: (a) => manager.restartProjectExceptNoRun(a.project) },
    { name: "reload_project_config", description: "Reread folder source using list(context). Works for my_wins and scripted; never launches commands.", properties: { project: string }, required: ["project"], run: (a) => folders.listFolder(a.project, true) },
    { name: "set_console_gather_errors", description: "Enable/disable error cards; enabled=null restores folder inheritance.", properties: { id: string, enabled: { type: ["boolean", "null"] } }, required: ["id", "enabled"], run: (a) => manager.setGatherErrors(a.id, a.enabled) },
    { name: "set_project_gather_errors", description: "Persist the folder default, keeping explicit per-console overrides.", properties: { project: string, enabled: boolean }, required: ["project", "enabled"], run: (a) => { folders.setGatherErrors(a.project, a.enabled); return folders.get(a.project); } }
  ];
  app.post("/mcp", route(async (req, res) => {
    const { method } = req.body;
    const hasId = Object.prototype.hasOwnProperty.call(req.body, "id");
    const id = req.body.id ?? null;
    if (!hasId && method?.startsWith("notifications/")) { res.status(202).end(); return; }
    if (method === "initialize") {
      const requested = req.body.params?.protocolVersions;
      const protocolVersion = Array.isArray(requested) && requested.includes("2024-11-05") ? "2024-11-05" : req.body.params?.protocolVersion ?? "2024-11-05";
      res.json({ jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "yconhost", version: "0.1.0" } } }); return;
    }
    if (method === "tools/list") {
      const tools = descriptors.map(({ name, description, properties, required }) => ({ name, description, inputSchema: { type: "object", properties, ...(required ? { required } : {}) } }));
      res.json({ jsonrpc: "2.0", id, tools, result: { tools } }); return;
    }
    if (method === "tools/call") {
      let content;
      let isError = false;
      try {
        const descriptor = descriptors.find((item) => item.name === req.body.params?.name);
        if (!descriptor) throw new Error(`Unsupported MCP tool ${req.body.params?.name}`);
        const args = req.body.params?.arguments ?? {};
        for (const required of descriptor.required ?? []) if (!(required in args)) throw new Error(`Missing required argument ${required}`);
        const value = await descriptor.run(args);
        content = [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
      } catch (error) {
        isError = true;
        content = [{ type: "text", text: error instanceof Error ? error.message : String(error) }];
      }
      res.json({ jsonrpc: "2.0", id, content, result: { content, ...(isError ? { isError: true } : {}) } }); return;
    }
    throw new Error(`Unsupported MCP method ${method}`);
  }));
  app.use(express.static(path.resolve("dist/client")));
  return app;
}

export function attachWebSocket(server: Server, manager: ConsoleManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    let subscribedConsoleId: string | undefined;
    const unsubscribe = manager.onOutput((consoleId, chunk) => {
      if (consoleId !== subscribedConsoleId) return;
      socket.send(JSON.stringify({ type: "output", consoleId, chunk }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; consoleId: string; data?: string; cols?: number; rows?: number };
      if (message.type === "subscribe") {
        subscribedConsoleId = message.consoleId;
        return;
      }
      if (message.type === "input" && message.data !== undefined) {
        try {
          manager.write(message.consoleId, message.data);
        } catch (error) {
          socket.send(JSON.stringify({ type: "error", consoleId: message.consoleId, message: error instanceof Error ? error.message : "Unknown error" }));
        }
      }
      if (message.type === "resize" && message.cols && message.rows) {
        try {
          manager.resize(message.consoleId, message.cols, message.rows);
        } catch (error) {
          socket.send(JSON.stringify({ type: "error", consoleId: message.consoleId, message: error instanceof Error ? error.message : "Unknown error" }));
        }
      }
    });
    socket.on("close", unsubscribe);
  });
  return wss;
}


function respond<T>(handler: (req: express.Request) => T): express.RequestHandler {
  return async (req, res) => { res.json(await handler(req)); };
}

function route(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    try { Promise.resolve(handler(req, res, next)).catch((error) => handleRouteError(error, res, next)); }
    catch (error) { handleRouteError(error, res, next); }
  };
}

function handleRouteError(error: unknown, res: express.Response, next: express.NextFunction): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (res.headersSent) { next(error); return; }
  res.status(message.includes("not found") ? 404 : 400).json({ error: message });
}

function param(req: express.Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
