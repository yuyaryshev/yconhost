import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const source = await import(pathToFileURL(workerData.scriptPath).href);
const capabilities = Object.fromEntries(["create", "update", "delete", "readOutput"].map((name) => [name, typeof source[name] === "function"]));
if (typeof source.list !== "function") throw new Error("Folder script must export list(context)");

parentPort.on("message", async ({ id, method, args }) => {
  try {
    const handler = source[method];
    if (typeof handler !== "function") {
      if (method === "defineFields") {
        parentPort.postMessage({ id, result: null, capabilities });
        return;
      }
      throw new Error(`Folder script does not support ${method}`);
    }
    const result = await handler(...args);
    const bytes = Buffer.byteLength(JSON.stringify(result ?? null));
    if (bytes > 10 * 1024 * 1024) throw new Error("Folder script result exceeds 10 MB");
    parentPort.postMessage({ id, result, capabilities });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
