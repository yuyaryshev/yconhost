import express from "express";
import type { Server } from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { ConsoleManager } from "./consoleManager.js";

export function createApp(manager: ConsoleManager): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/consoles", (req, res) => {
    res.json({ consoles: manager.list(req.query.project?.toString()) });
  });

  app.get("/api/projects", (_req, res) => {
    res.json({ projects: manager.listProjects() });
  });

  app.post("/api/consoles", route(respond((req) => manager.create(req.body))));

  app.post("/api/batch", route(respond((req) => manager.createBatch(req.body.projectPath, req.body.fileName))));

  app.get(
    "/api/consoles/:id",
    route(respond((req) => manager.get(param(req, "id"))))
  );

  app.get(
    "/api/consoles/:id/output",
    route(
      respond((req) => ({
        output: manager.readOutput(param(req, "id"), req.query.tailLines ? Number(req.query.tailLines) : undefined)
      }))
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

  app.delete(
    "/api/consoles/:id",
    route(
      respond((req) => {
        manager.kill(param(req, "id"));
        return { ok: true };
      })
    )
  );

  app.post("/api/consoles/:id/mode", route(respond((req) => manager.setMode(param(req, "id"), req.body.mode))));
  app.post("/api/consoles/:id/vanilla", route(respond((req) => manager.setVanillaVisible(param(req, "id"), Boolean(req.body.visible)))));

  app.post(
    "/mcp",
    route(
      respond((req) => {
        const method = req.body.method;
        if (method === "tools/list") {
          return {
            tools: [
              { name: "list_consoles", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
              { name: "read_console", inputSchema: { type: "object", properties: { id: { type: "string" }, tailLines: { type: "number" } }, required: ["id"] } },
              { name: "write_console", inputSchema: { type: "object", properties: { id: { type: "string" }, data: { type: "string" } }, required: ["id", "data"] } }
            ]
          };
        }
        if (method === "tools/call") {
          const { name, arguments: args = {} } = req.body.params ?? {};
          if (name === "list_consoles") return { content: [{ type: "text", text: JSON.stringify(manager.list(args.project), null, 2) }] };
          if (name === "read_console") return { content: [{ type: "text", text: manager.readOutput(args.id, args.tailLines) }] };
          if (name === "write_console") {
            manager.write(args.id, args.data);
            return { content: [{ type: "text", text: "ok" }] };
          }
        }
        throw new Error(`Unsupported MCP method ${method}`);
      })
    )
  );

  app.use(express.static(path.resolve("dist/client")));
  return app;
}

export function attachWebSocket(server: Server, manager: ConsoleManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    const unsubscribe = manager.onOutput((consoleId, chunk) => {
      socket.send(JSON.stringify({ type: "output", consoleId, chunk }));
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; consoleId: string; data?: string; cols?: number; rows?: number };
      if (message.type === "input" && message.data !== undefined) {
        try {
          manager.write(message.consoleId, message.data);
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
      handler(req, res, next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  };
}

function param(req: express.Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
