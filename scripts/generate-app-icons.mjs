import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const chrome = [
  process.env.CHROME_PATH,
  path.join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe")
].find((candidate) => candidate && fs.existsSync(candidate));
if (!chrome) throw new Error("Set CHROME_PATH to a Chromium browser executable to regenerate icons.");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "yconsole-icons-"));
const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser startup timed out")), 20_000);
    let stderr = "";
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timeout } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const source = fs.readFileSync(path.join(root, "public/favicon.svg"), "utf8");
  const sizes = [16, 32, 48, 180, 192, 256, 512];
  const frames = new Map();
  fs.mkdirSync(path.join(root, "public/icons"), { recursive: true });
  for (const maskable of [false, true]) {
    const svg = maskable ? source.replace('rx="12"', 'rx="0"') : source;
    for (const size of maskable ? [512] : sizes) {
      const result = await send("Runtime.evaluate", {
        expression: `(${async function (svg, size) {
          const image = new Image();
          image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          canvas.getContext("2d").drawImage(image, 0, 0, size, size);
          return canvas.toDataURL("image/png");
        }})(${JSON.stringify(svg)},${size})`, awaitPromise: true, returnByValue: true
      }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      const png = Buffer.from(result.result.value.slice("data:image/png;base64,".length), "base64");
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      fs.writeFileSync(path.join(root, `public/icons/yconsole-v2-${maskable ? "maskable-" : ""}${size}.png`), png);
      if (!maskable) frames.set(size, png);
    }
  }
  const icoSizes = [16, 32, 48, 256];
  const header = Buffer.alloc(6 + 16 * icoSizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  icoSizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames.get(size).length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames.get(size).length;
  });
  fs.writeFileSync(path.join(root, "public/favicon.ico"), Buffer.concat([header, ...icoSizes.map((size) => frames.get(size))]));
  await send("Browser.close");
  console.log("Generated PNG application icons and multi-resolution favicon.ico from public/favicon.svg");
} finally {
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  const resolved = path.resolve(profile);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
