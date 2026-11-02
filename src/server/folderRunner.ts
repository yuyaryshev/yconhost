import { Worker } from "node:worker_threads";
import type { FolderCapabilities } from "./folderTypes.js";

interface Result<T> { result: T; capabilities: FolderCapabilities }

export class FolderRunner {
  private worker?: Worker;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: Result<unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly scriptPath: string, private readonly timeoutMs = 10_000) {}

  call<T>(method: string, ...args: unknown[]): Promise<Result<T>> {
    if (!this.worker) {
      const worker = new Worker(new URL("./folderWorker.mjs", import.meta.url), { workerData: { scriptPath: this.scriptPath }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      this.worker = worker;
      worker.on("message", (message) => {
        const call = this.pending.get(message.id);
        if (!call) return;
        clearTimeout(call.timer);
        this.pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error));
        else call.resolve(message);
        if (this.pending.size === 0) worker.unref();
      });
      worker.on("error", (error) => this.fail(error));
      worker.on("exit", (code) => {
        if (this.worker === worker) {
          this.worker = undefined;
          this.fail(new Error(`Folder worker exited (${code})`));
        }
      });
    }
    this.worker.ref();
    return new Promise<Result<T>>((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.dispose(new Error(`Folder script ${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: Result<unknown>) => void, reject, timer });
      this.worker!.postMessage({ id, method, args });
    });
  }

  dispose(error = new Error("Folder worker stopped")): void {
    const worker = this.worker;
    this.worker = undefined;
    this.fail(error);
    if (worker) void worker.terminate();
  }

  private fail(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }
}
