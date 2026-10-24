import net from "node:net";

// The host serves one connection at a time. Keep one connection and serialize requests.
export class NativeControl {
  private socket?: net.Socket;
  private pending = "";
  private queue: Promise<unknown> = Promise.resolve();
  private reply?: { resolve: (line: string) => void; reject: (error: Error) => void };
  private closed = false;

  constructor(private readonly pipe: string, private readonly timeoutMs = 3000) {}

  async connect(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!this.closed) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(this.pipe);
          this.socket = socket;
          socket.setEncoding("utf8");
          socket.once("connect", resolve);
          socket.on("error", (error) => { reject(error); this.reply?.reject(error); });
          socket.on("close", () => this.reply?.reject(new Error("Native control pipe closed")));
          socket.on("data", (chunk: string) => {
            this.pending += chunk;
            if (this.pending.length > 8 * 1024 * 1024) {
              this.reply?.reject(new Error("Native control reply too large"));
              socket.destroy();
              return;
            }
            const end = this.pending.indexOf("\n");
            if (end >= 0) {
              const line = this.pending.slice(0, end).trimEnd();
              this.pending = this.pending.slice(end + 1);
              this.reply?.resolve(line);
            }
          });
        });
        return;
      } catch (error) {
        this.socket?.destroy();
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error("Native control closed");
  }

  command(command: string): Promise<string> {
    const request = this.queue.then(() => new Promise<string>((resolve, reject) => {
      if (this.closed || !this.socket || this.socket.destroyed) return reject(new Error("Native control is not connected"));
      const timer = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error("Native control request timed out"));
      }, this.timeoutMs);
      const finish = () => { clearTimeout(timer); this.reply = undefined; };
      this.reply = {
        resolve: (line) => { finish(); line === "ok" || line.startsWith("ok ") ? resolve(line) : reject(new Error(line)); },
        reject: (error) => { finish(); reject(error); }
      };
      this.socket.write(`${command}\n`);
    }));
    this.queue = request.catch(() => undefined);
    return request;
  }

  close(): void {
    this.closed = true;
    this.reply?.reject(new Error("Native control closed"));
    this.socket?.destroy();
  }
}
