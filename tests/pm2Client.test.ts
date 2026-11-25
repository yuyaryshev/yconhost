import crypto from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Pm2Monitor, pm2RpcEndpoint } from "../src/server/folders/pm2Client.mjs";

const require = createRequire(import.meta.url);
const axon = require("pm2-axon");
const rpc = require("pm2-axon-rpc");
const monitors: Pm2Monitor[] = [];
const servers: any[] = [];

afterEach(async () => {
  for (const monitor of monitors.splice(0)) monitor.close();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(resolve));
});

function endpoint() {
  const name = `yconhost-pm2-test-${crypto.randomUUID()}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

async function serve(address: string, handler: (done: (error: Error | null, rows?: unknown) => void) => void) {
  const socket = axon.socket("rep");
  const server = new rpc.Server(socket);
  let connections = 0;
  const methods: string[] = [];
  socket.on("connect", () => { connections++; });
  socket.on("message", (request: { method: string }) => methods.push(request.method));
  server.expose("getMonitorData", (_options: object, done: (error: Error | null, rows?: unknown) => void) => handler(done));
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.once("bind", resolve); socket.bind(address); });
  servers.push(socket);
  return { socket, methods, connections: () => connections };
}

function monitor(address: string, timeoutMs = 3000) {
  const client = new Pm2Monitor({ endpoint: address, timeoutMs });
  monitors.push(client);
  return client;
}

it("uses PM2's platform socket conventions without changing the daemon home", () => {
  expect(pm2RpcEndpoint({ PM2_HOME: "/state" }, "linux")).toBe(path.resolve("/state", "rpc.sock"));
  expect(pm2RpcEndpoint({ HOME: "/user" }, "linux")).toBe(path.resolve("/user", ".pm2", "rpc.sock"));
  expect(pm2RpcEndpoint({ PM2_DAEMON_RPC_PORT: "/custom.sock" }, "linux")).toBe("/custom.sock");
  expect(pm2RpcEndpoint({ PM2_HOME: "ignored", PM2_DAEMON_RPC_PORT: "ignored" }, "win32")).toBe("\\\\.\\pipe\\rpc.sock");
});

it("reuses one RPC connection, coalesces overlapping polls and calls only getMonitorData", async () => {
  const address = endpoint();
  let calls = 0;
  const server = await serve(address, (done) => { calls++; done(null, [{ pm_id: calls, name: "service" }]); });
  const client = monitor(address);
  expect(await client.list()).toEqual([{ pm_id: 1, name: "service" }]);
  expect(await client.list()).toEqual([{ pm_id: 2, name: "service" }]);
  const one = client.list();
  const two = client.list();
  expect(one).toBe(two);
  expect(await one).toEqual([{ pm_id: 3, name: "service" }]);
  expect(server.connections()).toBe(1);
  expect(server.methods).toEqual(["getMonitorData", "getMonitorData", "getMonitorData"]);
});

it("fails a missing endpoint without daemon startup and can later connect to an existing server", async () => {
  const address = endpoint();
  const client = monitor(address);
  await expect(client.list()).rejects.toThrow("PM2 RPC");
  expect(client.connection).toBeUndefined();
  await serve(address, (done) => done(null, []));
  expect(await client.list()).toEqual([]);
});

it("rejects daemon errors and invalid lists, drops the connection and recovers on the next poll", async () => {
  const address = endpoint();
  let response: "error" | "invalid" | "ok" = "error";
  await serve(address, (done) => response === "error" ? done(new Error("monitor unavailable")) : done(null, response === "invalid" ? {} : []));
  const client = monitor(address);
  await expect(client.list()).rejects.toThrow("monitor unavailable");
  response = "invalid";
  await expect(client.list()).rejects.toThrow("Invalid PM2 process list");
  response = "ok";
  expect(await client.list()).toEqual([]);
});

it("bounds unanswered reads and cancels an in-flight read on close", async () => {
  const address = endpoint();
  await serve(address, () => undefined);
  const client = monitor(address, 150);
  await expect(client.list()).rejects.toThrow("timed out");
  expect(client.connection).toBeUndefined();
  const pending = client.list();
  const rejected = expect(pending).rejects.toThrow("client closed");
  client.close();
  await rejected;
});

it("reconnects after a fake daemon disconnect without starting any process", async () => {
  const address = endpoint();
  const first = await serve(address, (done) => done(null, [{ pm_id: 1 }]));
  const client = monitor(address);
  expect(await client.list()).toEqual([{ pm_id: 1 }]);
  servers.splice(servers.indexOf(first.socket), 1);
  await new Promise<void>((resolve) => first.socket.close(resolve));
  await vi.waitFor(() => expect(client.connection).toBeUndefined());
  await serve(address, (done) => done(null, [{ pm_id: 2 }]));
  expect(await client.list()).toEqual([{ pm_id: 2 }]);
});
