import crypto from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Pm2Monitor, pm2RpcEndpoint, pm2PubEndpoint } from "../src/server/folders/pm2Client.mjs";

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

async function serve(address: string, handler: (done: (error: Error | null, rows?: unknown) => void) => void, reportCount = () => 1) {
  const socket = axon.socket("rep");
  const pub = axon.socket("pub-emitter");
  const server = new rpc.Server(socket);
  let connections = 0;
  const methods: string[] = [];
  socket.on("connect", () => { connections++; });
  socket.on("message", (request: { method: string }) => methods.push(request.method));
  server.expose("getMonitorData", (_options: object, done: (error: Error | null, rows?: unknown) => void) => handler(done));
  server.expose("getReport", (_options: object, done: (error: Error | null, report?: unknown) => void) => done(null, { managed_apps: reportCount() }));
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.once("bind", resolve); socket.bind(address); });
  servers.push(socket);
  await new Promise<void>((resolve, reject) => { pub.sock.once("error", reject); pub.sock.once("bind", resolve); pub.bind(`${address}-pub`); });
  servers.push(pub);
  return { socket, pub, rpc: server, methods, connections: () => connections, stop: async () => {
    for (const channel of [socket, pub]) {
      servers.splice(servers.indexOf(channel), 1);
      await new Promise<void>((resolve) => channel.close(resolve));
    }
  } };
}

function monitor(address: string, timeoutMs = 3000) {
  const client = new Pm2Monitor({ endpoint: address, pubEndpoint: `${address}-pub`, timeoutMs });
  monitors.push(client);
  return client;
}

it("uses PM2's platform socket conventions without changing the daemon home", () => {
  expect(pm2RpcEndpoint({ PM2_HOME: "/state" }, "linux")).toBe(path.resolve("/state", "rpc.sock"));
  expect(pm2RpcEndpoint({ HOME: "/user" }, "linux")).toBe(path.resolve("/user", ".pm2", "rpc.sock"));
  expect(pm2RpcEndpoint({ PM2_DAEMON_RPC_PORT: "/custom.sock" }, "linux")).toBe("/custom.sock");
  expect(pm2RpcEndpoint({ PM2_HOME: "ignored", PM2_DAEMON_RPC_PORT: "ignored" }, "win32")).toBe("\\\\.\\pipe\\rpc.sock");
  expect(pm2PubEndpoint({ PM2_HOME: "/state" }, "linux")).toBe(path.resolve("/state", "pub.sock"));
  expect(pm2PubEndpoint({ PM2_DAEMON_PUB_PORT: "/custom.pub" }, "linux")).toBe("/custom.pub");
  expect(pm2PubEndpoint({}, "win32")).toBe("\\\\.\\pipe\\pub.sock");
});

it("snapshots once, reuses connections and uses only metadata reports for regular polls", async () => {
  const address = endpoint();
  let calls = 0;
  const server = await serve(address, (done) => { calls++; done(null, [{ pm_id: calls, name: "service" }]); });
  const client = monitor(address);
  expect(await client.list()).toEqual([{ pm_id: 1, name: "service" }]);
  expect(await client.list()).toEqual([{ pm_id: 1, name: "service" }]);
  const one = client.list();
  const two = client.list();
  expect(one).toBe(two);
  expect(await one).toEqual([{ pm_id: 1, name: "service" }]);
  expect(server.connections()).toBe(1);
  expect(server.methods).toEqual(["getReport", "getMonitorData", "getReport", "getReport"]);
  for (let i = 0; i < 20; i++) await client.list();
  expect(calls).toBe(1);
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
  await first.stop();
  await vi.waitFor(() => expect(client.connection).toBeUndefined());
  await serve(address, (done) => done(null, [{ pm_id: 2 }]));
  expect(await client.list()).toEqual([{ pm_id: 2 }]);
});

it("refreshes names, PIDs, status and log paths after lifecycle events, but not log telemetry", async () => {
  const address = endpoint();
  let rows = [{ pm_id: 1, name: "old", pid: 100, pm2_env: { status: "online", pm_out_log_path: "old.log" } }];
  const server = await serve(address, done => done(null, rows));
  const client = monitor(address);
  await client.list();
  server.pub.emit("log:out", { process: { pm_id: 1 }, data: "output" });
  rows = [{ pm_id: 1, name: "new", pid: 200, pm2_env: { status: "stopped", pm_out_log_path: "new.log" } }];
  server.pub.emit("process:event", { event: "restart", process: { pm_id: 1 } });
  server.pub.emit("process:event", { event: "online", process: { pm_id: 1 } });
  await vi.waitFor(() => expect(client.connection.revision).toBe(2));
  expect(await client.list()).toEqual(rows);
  await client.list();
  expect(server.methods.filter(method => method === "getMonitorData")).toHaveLength(2);
});

it("detects additions and deletions from metadata counts even when no lifecycle event arrives", async () => {
  const address = endpoint();
  let rows = [{ pm_id: 1 }, { pm_id: 2 }];
  const server = await serve(address, done => done(null, rows), () => rows.length);
  const client = monitor(address);
  expect(await client.list()).toHaveLength(2);
  rows = [{ pm_id: 2 }];
  expect(await client.list()).toEqual(rows);
  rows = [{ pm_id: 2 }, { pm_id: 3 }];
  expect(await client.list()).toEqual(rows);
  await client.list();
  expect(server.methods.filter(method => method === "getMonitorData")).toHaveLength(3);
});

it("does not lose invalidation events received while a snapshot is in flight", async () => {
  const address = endpoint();
  let complete: ((error: Error | null, rows?: unknown) => void) | undefined;
  const server = await serve(address, done => { complete = done; });
  const client = monitor(address);
  const first = client.list();
  await vi.waitFor(() => expect(complete).toBeDefined());
  server.pub.emit("process:event", { event: "start", process: { pm_id: 2 } });
  await vi.waitFor(() => expect(client.connection.revision).toBe(1));
  complete!(null, [{ pm_id: 1 }]);
  await first;
  complete = undefined;
  const second = client.list();
  await vi.waitFor(() => expect(complete).toBeDefined());
  complete!(null, [{ pm_id: 2 }]);
  expect(await second).toEqual([{ pm_id: 2 }]);
});

it("rejects a lost event bus instead of returning an indefinitely stale cache", async () => {
  const address = endpoint();
  const server = await serve(address, done => done(null, []));
  const client = monitor(address);
  await client.list();
  servers.splice(servers.indexOf(server.pub), 1);
  await new Promise<void>(resolve => server.pub.close(resolve));
  await vi.waitFor(() => expect(client.connection).toBeUndefined());
  await expect(client.list()).rejects.toThrow("PM2 RPC");
  expect(server.methods.filter(method => method === "getMonitorData")).toHaveLength(1);
});

it.each(["error", "invalid", "timeout"])("does not hide metadata %s behind cached rows or fall back to metrics", async (mode) => {
  const address = endpoint();
  const server = await serve(address, done => done(null, [{ pm_id: 1 }]));
  const client = monitor(address, 300);
  await client.list();
  server.rpc.expose("getReport", (_options: object, done: (error: Error | null, report?: unknown) => void) => {
    if (mode === "timeout") return;
    if (mode === "error") return done(new Error("metadata unavailable"));
    done(null, { managed_apps: "1" });
  });
  await expect(client.list()).rejects.toThrow(mode === "timeout" ? "timed out" : mode === "error" ? "metadata unavailable" : "Invalid PM2 metadata report");
  expect(server.methods.filter(method => method === "getMonitorData")).toHaveLength(1);
});

it("does not resnapshot forever when PM2's raw managed count differs from its formatted list length", async () => {
  const address = endpoint();
  const server = await serve(address, done => done(null, [{ pm_id: 1 }]), () => 2);
  const client = monitor(address);
  for (let i = 0; i < 5; i++) await client.list();
  expect(server.methods.filter(method => method === "getMonitorData")).toHaveLength(1);
});
