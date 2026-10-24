import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { expect, it } from "vitest";
import { NativeControl } from "../src/server/nativeControl.js";

it("serializes pipe commands and reads fragmented replies", async () => {
  const id = crypto.randomUUID();
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\yconhost-test-${id}` : path.join(os.tmpdir(), `${id}.sock`);
  const received: string[] = [];
  const server = net.createServer((socket) => {
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk;
      for (let end; (end = pending.indexOf("\n")) >= 0;) {
        const command = pending.slice(0, end);
        pending = pending.slice(end + 1);
        received.push(command);
        socket.write(command === "bad" ? "err " : "ok ");
        setTimeout(() => socket.write(`${command}\n`), 10);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  const control = new NativeControl(pipe);
  try {
    await control.connect();
    expect(await Promise.all([control.command("visible"), control.command("size")])).toEqual(["ok visible", "ok size"]);
    await expect(control.command("bad")).rejects.toThrow("err bad");
    expect(await control.command("show")).toBe("ok show");
    expect(received).toEqual(["visible", "size", "bad", "show"]);
  } finally {
    control.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("times out a stuck host and rejects later requests", async () => {
  const pipe = process.platform === "win32" ? `\\\\.\\pipe\\yconhost-test-${crypto.randomUUID()}` : path.join(os.tmpdir(), `${crypto.randomUUID()}.sock`);
  const server = net.createServer((socket) => socket.on("data", () => undefined));
  await new Promise<void>((resolve) => server.listen(pipe, resolve));
  const control = new NativeControl(pipe, 30);
  try {
    await control.connect();
    await expect(control.command("visible")).rejects.toThrow("timed out");
    await expect(control.command("hide")).rejects.toThrow("not connected");
  } finally {
    control.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
