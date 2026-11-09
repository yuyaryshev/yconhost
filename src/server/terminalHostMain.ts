import { TerminalHost } from "./terminalHost.js";
import { loadSettings } from "./settings.js";

const host = new TerminalHost(loadSettings());
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  void host.close().finally(() => process.exit(0));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("message", message => { if (message === "shutdown") stop(); });
void host.listen().then(() => {
  console.log("yconhost terminal host ready");
  process.send?.("ready");
}).catch(error => { console.error("[terminal-host] Startup failed:", error); process.exit(1); });
