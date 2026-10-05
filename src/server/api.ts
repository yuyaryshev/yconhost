import express from "express";
import type { Server } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { ConsoleManager } from "./consoleManager.js";
import { Pm2Monitor } from "./pm2Monitor.js";
import { saveSettings } from "./settings.js";

export function createApp(manager: ConsoleManager, options: { pm2?: Pm2Monitor | false } = {}): express.Express {
  const app = express();
  const pm2 = options.pm2 === false ? undefined : options.pm2 ?? new Pm2Monitor();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/consoles", (req, res) => {
    const project = req.query.project?.toString();
    const consoles = project === "pm2" ? pm2?.list() ?? [] : [...manager.list(project), ...(project || !pm2 ? [] : pm2.list())];
    res.json({ consoles });
  });

  app.get("/api/projects", (_req, res) => {
    const pm2Consoles = pm2?.list() ?? [];
    res.json({
      projects: [
        ...manager.listProjects(),
        ...(pm2 ? [{
          name: "pm2",
          consoleCount: pm2Consoles.length,
          runningCount: pm2Consoles.filter((row) => row.status === "running").length,
          readyCount: 0,
          unseenErrorCount: 0
        }] : [])
      ]
    });
  });

  app.post("/api/projects", route(respond((req) => manager.createProject(String(req.body.name ?? "")))));

  app.get("/api/recent-projects", (_req, res) => {
    res.json({ projects: manager.recentProjects() });
  });

  app.get("/api/settings", (_req, res) => {
    res.json({ settings: manager.getSettings() });
  });

  app.post(
    "/api/settings",
    route(
      respond((req) => ({
        settings: manager.updateSettings(saveSettings(req.body.settings ?? req.body))
      }))
    )
  );

  app.delete(
    "/api/recent-projects",
    route(
      respond((req) => ({
        projects: manager.removeRecentProject(String(req.body.projectPath ?? ""))
      }))
    )
  );

  app.post("/api/consoles", route(respond((req) => manager.create(req.body))));

  app.post("/api/batch", route(respond((req) => manager.createBatch(req.body.projectPath, req.body.fileName))));

  app.get(
    "/api/consoles/:id",
    route(respond((req) => {
      const id = param(req, "id");
      if (pm2?.has(id)) {
        const snapshot = pm2.get(id);
        if (!snapshot) throw new Error(`Console ${id} not found`);
        return snapshot;
      }
      return manager.get(id);
    }))
  );

  app.get(
    "/api/consoles/:id/output",
    route(
      respond((req) => ({
        output: pm2?.has(param(req, "id"))
          ? pm2.readOutput(param(req, "id"), req.query.tailLines ? Number(req.query.tailLines) : undefined)
          : manager.readOutput(param(req, "id"), req.query.tailLines ? Number(req.query.tailLines) : undefined)
      }))
    )
  );

  app.get(
    "/api/consoles/:id/state",
    route(
      respond((req) => {
        const id = param(req, "id");
        const tailLines = req.query.tailLines ? Number(req.query.tailLines) : undefined;
        if (pm2?.has(id)) {
          const state = pm2.getState(id, tailLines);
          if (!state) throw new Error(`Console ${id} not found`);
          return state;
        }
        return manager.getState(id, tailLines);
      })
    )
  );

  app.post(
    "/api/consoles/:id/input",
    route(
      respond((req) => {
        manager.write(param(req, "id"), String(req.body.data ?? ""));
        return { ok: true };
      })
    )
  );

  app.post(
    "/api/consoles/:id/signal",
    route(
      respond((req) => {
        manager.signal(param(req, "id"), String(req.body.signal ?? "ctrl+c").toLowerCase());
        return { ok: true };
      })
    )
  );

  app.post("/api/consoles/:id/restart", route(respond((req) => manager.restart(param(req, "id")))));

  app.post("/api/consoles/:id/start", route(respond((req) => manager.start(param(req, "id")))));

  app.post("/api/consoles/:id/name", route(respond((req) => manager.rename(param(req, "id"), String(req.body.name ?? "")))));

  app.post("/api/consoles/:id/read", route(respond((req) => manager.markRead(param(req, "id")))));

  app.get("/api/consoles/:id/mywins", route(respond((req) => manager.getMywinsEntry(param(req, "id")))));

  app.put("/api/consoles/:id/mywins", route(respond((req) => manager.updateMywinsEntry(param(req, "id"), req.body))));

  app.delete("/api/consoles/:id/mywins", route(respond((req) => manager.deleteMywinsEntry(param(req, "id")))));

  app.delete(
    "/api/consoles/:id",
    route(
      respond((req) => {
        manager.kill(param(req, "id"));
        return { ok: true };
      })
    )
  );

  app.post("/api/projects/:project/restart", route(respond((req) => manager.restartProject(param(req, "project")))));
  app.post("/api/projects/:project/restart-except-no-run", route(respond((req) => manager.restartProjectExceptNoRun(param(req, "project")))));
  app.post("/api/projects/:project/stop", route(respond((req) => {
    manager.stopProject(param(req, "project"));
    return { ok: true };
  })));
  app.post("/api/projects/:project/start", route(respond((req) => manager.startProject(param(req, "project")))));
  app.post("/api/projects/:project/reload", route(respond((req) => manager.reloadProjectConfig(param(req, "project")))));
  app.post("/api/projects/:project/mywins", route(respond((req) => manager.addMywinsEntry(param(req, "project"), req.body))));
  app.post("/api/codex-contexts/import", route(respond((req) => manager.importCodexContexts(req.body ?? {}))));
  app.post("/api/projects/:project/read", route(respond((req) => {
    manager.markProjectRead(param(req, "project"));
    return { ok: true };
  })));
  app.delete("/api/projects/:project", route(respond((req) => {
    manager.closeProject(param(req, "project"));
    return { ok: true };
  })));

  app.post(
    "/mcp",
    route(async (req, res) => {
        const method = req.body.method;
        const hasId = Object.prototype.hasOwnProperty.call(req.body, "id");
        const id = req.body.id ?? null;
        if (!hasId && (method === "notifications/initialized" || method?.startsWith("notifications/"))) {
          res.status(202).end();
          return;
        }
        if (method === "tools/list") {
          const tools = [
            { name: "list_consoles", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
            { name: "list_projects", description: "List visible yconhost projects, including empty MCP-managed projects and projects inferred from registered consoles.", inputSchema: { type: "object", properties: {} } },
            { name: "create_project", description: "Create a named yconhost project managed by MCP/UI. It is persisted in yconhost state and does not require or write mywins.json.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
            { name: "import_codex_contexts", description: "Import all Codex launch contexts into the codexes yconhost project by default. Consoles are registered as idle colored slots; no Codex process is started by import or by selecting a slot.", inputSchema: { type: "object", properties: { project: { type: "string" }, contextsPath: { type: "string" }, weztermPresetsPath: { type: "string" } } } },
            { name: "get_console_state", description: "Read structured state for a console session, including status, timestamps for last input and last output, and the last few output lines. tailLines defaults to 8.", inputSchema: { type: "object", properties: { id: { type: "string" }, tailLines: { type: "number" } }, required: ["id"] } },
            { name: "read_console", inputSchema: { type: "object", properties: { id: { type: "string" }, tailLines: { type: "number" } }, required: ["id"] } },
            { name: "write_console", inputSchema: { type: "object", properties: { id: { type: "string" }, data: { type: "string" } }, required: ["id", "data"] } },
            { name: "send_console_command", description: "Send a command line to an existing running console and return immediately without waiting for completion.", inputSchema: { type: "object", properties: { id: { type: "string" }, command: { type: "string" } }, required: ["id", "command"] } },
            { name: "run_console_command", description: "Run a command line in an existing running console, wait until a completion marker is printed, and return captured output plus exitCode. timeoutMs defaults to 30000.", inputSchema: { type: "object", properties: { id: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "number" } }, required: ["id", "command"] } },
            { name: "create_console", description: "Create and start a console. MCP-created consoles are temporary by default and self-delete after the configured idle TTL; pass persistent=true to keep one.", inputSchema: { type: "object", properties: { name: { type: "string" }, project: { type: "string" }, projectPath: { type: "string" }, cwd: { type: "string" }, command: { type: "string" }, shell: { type: "string" }, args: { type: "array", items: { type: "string" } }, noRun: { type: "boolean" }, persistent: { type: "boolean" }, ansiParserEnabled: { type: "boolean" } } } },
            { name: "register_console", description: "Register a console slot in an MCP/UI-managed project without using mywins.json. By default it is idle and temporary; pass start=true to launch it immediately or persistent=true to keep it.", inputSchema: { type: "object", properties: { project: { type: "string" }, name: { type: "string" }, projectPath: { type: "string" }, cwd: { type: "string" }, command: { type: "string" }, shell: { type: "string" }, args: { type: "array", items: { type: "string" } }, noRun: { type: "boolean" }, start: { type: "boolean" }, persistent: { type: "boolean" }, ansiParserEnabled: { type: "boolean" } }, required: ["project"] } },
            { name: "close_console", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
            { name: "restart_console", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
            { name: "start_console", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
            { name: "stop_console", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
            { name: "restart_project_except_no_run", inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } },
            { name: "reload_project_config", inputSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } }
          ];
          res.json({
            jsonrpc: "2.0",
            id,
            tools,
            result: { tools }
          });
          return;
        }
        if (method === "tools/call") {
          const { name, arguments: args = {} } = req.body.params ?? {};
          const content = (text: string) => {
            const blocks = [{ type: "text", text }];
            res.json({ jsonrpc: "2.0", id, content: blocks, result: { content: blocks } });
          };
          if (name === "list_consoles") {
            const project = args.project;
            const consoles = project === "pm2" ? pm2?.list() ?? [] : [...manager.list(project), ...(project || !pm2 ? [] : pm2.list())];
            content(JSON.stringify(consoles, null, 2));
            return;
          }
          if (name === "list_projects") {
            const projects = [...manager.listProjects(), ...(pm2 ? [{
              name: "pm2",
              consoleCount: pm2.list().length,
              runningCount: pm2.list().filter((row) => row.status === "running").length,
              readyCount: 0,
              unseenErrorCount: 0
            }] : [])];
            content(JSON.stringify(projects, null, 2));
            return;
          }
          if (name === "create_project") {
            content(JSON.stringify(manager.createProject(String(args.name ?? "")), null, 2));
            return;
          }
          if (name === "import_codex_contexts") {
            content(JSON.stringify(manager.importCodexContexts(args), null, 2));
            return;
          }
          if (name === "read_console") {
            content(pm2?.has(args.id) ? pm2.readOutput(args.id, args.tailLines) : manager.readOutput(args.id, args.tailLines));
            return;
          }
          if (name === "get_console_state") {
            const state = pm2?.has(args.id) ? pm2.getState(args.id, args.tailLines) : manager.getState(args.id, args.tailLines);
            if (!state) throw new Error(`Console ${args.id} not found`);
            content(JSON.stringify(state, null, 2));
            return;
          }
          if (name === "write_console") {
            if (pm2?.has(args.id)) throw new Error(`Console ${args.id} is readonly`);
            manager.write(args.id, args.data);
            content("ok");
            return;
          }
          if (name === "send_console_command") {
            if (pm2?.has(args.id)) throw new Error(`Console ${args.id} is readonly`);
            content(JSON.stringify(await manager.runCommand(args.id, args.command, { wait: false }), null, 2));
            return;
          }
          if (name === "run_console_command") {
            if (pm2?.has(args.id)) throw new Error(`Console ${args.id} is readonly`);
            content(JSON.stringify(await manager.runCommand(args.id, args.command, { wait: true, timeoutMs: args.timeoutMs }), null, 2));
            return;
          }
          if (name === "create_console") {
            content(JSON.stringify(manager.create({ ...args, persistent: args.persistent === true }), null, 2));
            return;
          }
          if (name === "register_console") {
            content(JSON.stringify(manager.registerConsole({ ...args, persistent: args.persistent === true }), null, 2));
            return;
          }
          if (name === "close_console") {
            if (pm2?.has(args.id)) throw new Error(`Console ${args.id} is readonly`);
            manager.kill(args.id);
            content("ok");
            return;
          }
          if (name === "restart_console") {
            content(JSON.stringify(manager.restart(args.id), null, 2));
            return;
          }
          if (name === "start_console") {
            content(JSON.stringify(manager.start(args.id), null, 2));
            return;
          }
          if (name === "stop_console") {
            manager.stop(args.id);
            content("ok");
            return;
          }
          if (name === "restart_project_except_no_run") {
            content(JSON.stringify(manager.restartProjectExceptNoRun(args.project), null, 2));
            return;
          }
          if (name === "reload_project_config") {
            content(JSON.stringify(manager.reloadProjectConfig(args.project), null, 2));
            return;
          }
          throw new Error(`Unsupported MCP tool ${name}`);
        }
        if (method === "initialize") {
          const requestedVersions = Array.isArray(req.body.params?.protocolVersions) ? req.body.params.protocolVersions : [];
          const protocolVersion = requestedVersions.includes("2024-11-05") ? "2024-11-05" : req.body.params?.protocolVersion ?? "2024-11-05";
          const result = { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "yconhost", version: "0.1.0" } };
          res.json({ jsonrpc: "2.0", id, result });
          return;
        }
        throw new Error(`Unsupported MCP method ${method}`);
    })
  );

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

function respond<T>(handler: (req: express.Request) => T): (req: express.Request, res: express.Response) => void {
  return (req, res) => res.json(handler(req));
}

function route(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    try {
      Promise.resolve(handler(req, res, next)).catch((error) => handleRouteError(error, res, next));
    } catch (error) {
      handleRouteError(error, res, next);
    }
  };
}

function handleRouteError(error: unknown, res: express.Response, next: express.NextFunction): void {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (res.headersSent) {
        next(error);
        return;
      }
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
}

function param(req: express.Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
