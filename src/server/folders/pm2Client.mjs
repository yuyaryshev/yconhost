import os from "node:os";
import path from "node:path";
import axon from "pm2-axon";
import rpc from "pm2-axon-rpc";

export function pm2RpcEndpoint(env = process.env, platform = process.platform) {
  if (platform === "win32") return "\\\\.\\pipe\\rpc.sock";
  return env.PM2_DAEMON_RPC_PORT || path.resolve(env.PM2_HOME || path.join(env.HOME || os.homedir(), ".pm2"), "rpc.sock");
}

export function pm2PubEndpoint(env = process.env, platform = process.platform) {
  if (platform === "win32") return "\\\\.\\pipe\\pub.sock";
  return env.PM2_DAEMON_PUB_PORT || path.resolve(env.PM2_HOME || path.join(env.HOME || os.homedir(), ".pm2"), "pub.sock");
}

// PM2 has no metadata-only full-list RPC. Snapshot on connect/change, never on idle polls.
export class Pm2Monitor {
  connection;
  pending;

  constructor({ endpoint = pm2RpcEndpoint(), pubEndpoint = pm2PubEndpoint(), timeoutMs = 5000 } = {}) {
    this.endpoint = endpoint;
    this.pubEndpoint = pubEndpoint;
    this.timeoutMs = timeoutMs;
  }

  /** @returns {Promise<any[]>} */
  list() {
    if (this.pending) return this.pending.promise;
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const pending = { promise, finish: (error, rows) => {
      if (this.pending !== pending) return;
      clearTimeout(timer);
      this.pending = undefined;
      if (!error && !Array.isArray(rows)) error = new Error("Invalid PM2 process list");
      if (error) {
        this.disconnect();
        reject(new Error(`PM2 RPC: ${error.message}`));
      } else resolve(rows);
    } };
    this.pending = pending;
    const timer = setTimeout(() => pending.finish(new Error(`read timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    if (!this.connection) {
      const socket = axon.socket("req");
      socket.set("retry timeout", 0);
      const bus = axon.socket("sub-emitter");
      bus.sock.set("retry timeout", 0);
      const connection = { socket, client: new rpc.Client(socket), bus, revision: 0 };
      this.connection = connection;
      const lost = (error = new Error("connection closed")) => {
        if (this.connection !== connection) return;
        if (this.pending) this.pending.finish(error);
        else this.disconnect();
      };
      socket.on("error", lost);
      socket.on("socket error", lost);
      socket.on("close", () => lost());
      bus.sock.on("error", lost);
      bus.sock.on("socket error", lost);
      bus.sock.on("close", () => lost());
      bus.on("process:event", () => { connection.revision++; });
      bus.on("pm2:kill", () => lost(new Error("daemon stopping")));
      socket.once("connect", () => this.request(connection));
      bus.sock.once("connect", () => this.request(connection));
      try { bus.connect(this.pubEndpoint); socket.connect(this.endpoint); } catch (error) { lost(error); }
    } else this.request(this.connection);
    return promise;
  }

  request(connection) {
    if (this.connection !== connection || !this.pending || !connection.socket.connected || !connection.bus.sock.connected) return;
    const pending = this.pending;
    if (pending.started) return;
    pending.started = true;
    try { connection.client.call("getReport", {}, (error, report) => {
      if (this.connection !== connection || this.pending !== pending) return;
      if (error) return pending.finish(error);
      if (!Number.isInteger(report?.managed_apps) || report.managed_apps < 0) return pending.finish(new Error("Invalid PM2 metadata report"));
      if (connection.rows && connection.snapshotRevision === connection.revision && connection.reportedCount === report.managed_apps) return pending.finish(null, connection.rows);
      const revision = connection.revision;
      // getMonitorData runs pidusage/WMIC in PM2: reserve it for controlled resynchronization.
      connection.client.call("getMonitorData", {}, (error, rows) => {
        if (this.connection !== connection || this.pending !== pending) return;
        if (!error && Array.isArray(rows)) {
          connection.rows = rows;
          connection.snapshotRevision = revision;
          connection.reportedCount = report.managed_apps;
        }
        pending.finish(error, rows);
      });
    }); }
    catch (error) { this.pending?.finish(error); }
  }

  disconnect() {
    const connection = this.connection;
    this.connection = undefined;
    connection?.socket.close();
    connection?.bus.close();
  }

  close() {
    if (this.pending) this.pending.finish(new Error("client closed"));
    else this.disconnect();
  }
}
