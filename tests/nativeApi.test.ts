import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { expect, it, vi } from "vitest";
import xtermHeadless from "@xterm/headless";
import { ConsoleManager } from "../src/server/consoleManager.js";
import { createApp } from "../src/server/api.js";
import { LogStore } from "../src/server/logStore.js";
import { loadSettings, saveSettings } from "../src/server/settings.js";
import { FakeTerminalFactory, FakeTerminalSession } from "../src/server/terminal.js";
import type { NativeWindowState } from "../src/server/types.js";

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yconhost-native-api-"));
  const defaults = loadSettings(path.join(dataDir, "missing.json5"));
  const settings = {
    ...defaults, dataDir, terminal: { ...defaults.terminal },
    codexContexts: { ...defaults.codexContexts, contextsPath: path.join(dataDir, "missing.md"), weztermPresetsPath: path.join(dataDir, "missing.lua") }
  };
  const factory = new FakeTerminalFactory();
  const manager = new ConsoleManager(settings, new LogStore(settings), factory);
  return { settings, factory, manager, app: createApp(manager, { pm2: false }), dataDir };
}

it("exposes actual native state, rejects unsupported sessions and clears state on close", async () => {
  const { manager, factory, app, settings } = setup();
  try {
    const standard = manager.create({ name: "standard" });
    await request(app).get(`/api/consoles/${standard.id}/native`).expect(400);
    await request(app).post(`/api/consoles/${standard.id}/native`).send({ visible: "true" }).expect(400);

    let state: NativeWindowState = { visible: false, cols: 160, rows: 40 };
    let notify: ((state: NativeWindowState) => void) | undefined;
    const native = Object.assign(new FakeTerminalSession(), {
      nativeWindow: vi.fn(async (visible?: boolean) => {
        state = { ...state, visible: visible ?? state.visible };
        notify?.(state);
        return state;
      }),
      onNativeWindow: (listener: (state: NativeWindowState) => void) => { notify = listener; }
    });
    vi.spyOn(factory, "spawn").mockReturnValue(native);
    const record = manager.create({ project: "native", name: "native" });
    notify?.(state);
    expect((await request(app).post(`/api/consoles/${record.id}/native`).send({ visible: true }).expect(200)).body.visible).toBe(true);
    expect(manager.list().find((row) => row.id === record.id)?.nativeCli?.visible).toBe(true);
    const pid = record.pid;
    manager.updateSettings({ ...settings, terminal: { ...settings.terminal, host: "yopenconsole" } });
    expect(record.pid).toBe(pid);
    expect(factory.spawn).toHaveBeenCalledTimes(1);
    notify?.({ ...state, visible: false });
    expect(record.nativeCli?.visible).toBe(false);
    manager.kill(record.id);
    expect(record.status).toBe("idle");
    expect(record.nativeCli).toBeUndefined();
    await request(app).get(`/api/consoles/${record.id}/native`).expect(400);
    notify?.({ ...state, visible: true });
    expect(record.nativeCli).toBeUndefined();
  } finally { manager.dispose(); }
});

it("does not apply a late window response to a restarted console", async () => {
  const { manager, factory } = setup();
  try {
    let complete: ((state: NativeWindowState) => void) | undefined;
    const session = Object.assign(new FakeTerminalSession(), {
      nativeWindow: () => new Promise<NativeWindowState>((resolve) => { complete = resolve; })
    });
    vi.spyOn(factory, "spawn").mockReturnValueOnce(session).mockReturnValue(new FakeTerminalSession());
    const record = manager.create({ project: "native" });
    const pending = manager.nativeWindow(record.id, true);
    manager.restart(record.id);
    complete!({ visible: true, cols: 80, rows: 24 });
    await expect(pending).rejects.toThrow("session changed");
    expect(manager.get(record.id).nativeCli).toBeUndefined();
  } finally { manager.dispose(); }
});

it("retains old logs but clears their screen and terminal modes before a new native run", async () => {
  const { manager, factory, settings } = setup();
  const terminal = new xtermHeadless.Terminal({ cols: 160, rows: 40, allowProposedApi: true });
  try {
    const record = manager.create({ project: "native" });
    factory.sessions[0].push("OLD_RUN_TEXT\r\n\x1b[?1049hOLD_ALT_SCREEN");
    manager.updateSettings({ ...settings, terminal: { ...settings.terminal, host: "yopenconsole" } });
    manager.restart(record.id);
    factory.sessions[1].push("NEW_RUN\x1b[1;1Hnew");
    const log = manager.readOutput(record.id);
    expect(log).toContain("OLD_RUN_TEXT");
    await new Promise<void>((resolve) => terminal.write(log, resolve));
    expect(terminal.buffer.active.type).toBe("normal");
    const screen = Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(y)?.translateToString(true) ?? "").join("\n");
    expect(screen).toContain("new_RUN");
    expect(screen).not.toContain("OLD_");
  } finally { terminal.dispose(); manager.dispose(); }
});

it("persists host selection, rejects missing binaries on save but still boots if a configured binary disappears", () => {
  const { manager, settings, dataDir } = setup();
  try {
    const file = path.join(dataDir, "settings.json5");
    const host = path.join(dataDir, "test-host.exe");
    fs.copyFileSync(process.execPath, host);
    const next = { ...settings, terminal: { ...settings.terminal, host: "yopenconsole" as const, yopenconsolePath: host } };
    saveSettings(next, file);
    expect(loadSettings(file).terminal.host).toBe("yopenconsole");
    expect(() => saveSettings({ ...next, terminal: { ...next.terminal, yopenconsolePath: `${host}.missing` } }, file)).toThrow("not found");
    fs.unlinkSync(host);
    expect(loadSettings(file).terminal.host).toBe("yopenconsole");
  } finally { manager.dispose(); }
});
