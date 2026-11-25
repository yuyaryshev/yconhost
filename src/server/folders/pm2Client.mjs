import os from "node:os";
import path from "node:path";
import axon from "pm2-axon";
import rpc from "pm2-axon-rpc";

export function pm2RpcEndpoint(env = process.env, platform = process.platform) {
  if (platform === "win32") return "\\\\.\\pipe\\rpc.sock";
  return env.PM2_DAEMON_RPC_PORT || path.resolve(env.PM2_HOME || path.join(env.HOME || os.homedir(), ".pm2"), "rpc.sock");
}

// Only the monitor RPC is exposed: connecting must never start or repair PM2.
export class Pm2Monitor {
  connection;
  pending;

  constructor({ endpoint = pm2RpcEndpoint(), timeoutMs = 5000 } = {}) {
    this.endpoint = endpoint;
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
      const connection = { socket, client: new rpc.Client(socket) };
      this.connection = connection;
      const lost = (error = new Error("connection closed")) => {
        if (this.connection !== connection) return;
        if (this.pending) this.pending.finish(error);
        else this.disconnect();
      };
      socket.on("error", lost);
      socket.on("socket error", lost);
      socket.on("close", () => lost());
      socket.once("connect", () => this.request(connection));
      try { socket.connect(this.endpoint); } catch (error) { lost(error); }
    } else this.request(this.connection);
    return promise;
  }

  request(connection) {
    if (this.connection !== connection || !this.pending) return;
    try { connection.client.call("getMonitorData", {}, this.pending.finish); }
    catch (error) { this.pending?.finish(error); }
  }

  disconnect() {
    const connection = this.connection;
    this.connection = undefined;
    connection?.socket.close();
  }

  close() {
    if (this.pending) this.pending.finish(new Error("client closed"));
    else this.disconnect();
  }
}
