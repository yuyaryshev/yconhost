import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Dialog, DialogDismiss, DialogHeading, useDialogStore } from "@ariakit/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type ConsoleMode = "managed" | "manual";
type ConsoleRecord = {
  id: string;
  name: string;
  project: string;
  cwd: string;
  command: string;
  status: "starting" | "running" | "ready" | "exited" | "detached";
  mode: ConsoleMode;
  vanillaVisible: boolean;
  errorCount: number;
  unseenErrorCount: number;
  attached: boolean;
};

function App() {
  const [consoles, setConsoles] = useState<ConsoleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [command, setCommand] = useState("cmd.exe");
  const [cwd, setCwd] = useState("");
  const dialog = useDialogStore();
  const selected = consoles.find((item) => item.id === selectedId);

  async function refresh() {
    const response = await fetch("/api/consoles");
    const data = (await response.json()) as { consoles: ConsoleRecord[] };
    setConsoles(data.consoles);
    setSelectedId((current) => current ?? data.consoles[0]?.id);
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);

  async function createConsole() {
    const response = await fetch("/api/consoles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, cwd: cwd || undefined, name: command })
    });
    const created = (await response.json()) as ConsoleRecord;
    setSelectedId(created.id);
    dialog.hide();
    await refresh();
  }

  const projects = useMemo(() => {
    const names = new Set(["Default", ...consoles.map((item) => item.project)]);
    return [...names].map((project) => ({ project, consoles: consoles.filter((item) => item.project === project) }));
  }, [consoles]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>yconhost</h1>
          <Button className="icon-button" onClick={dialog.show} title="Create console">
            +
          </Button>
        </div>
        <div className="project-list">
          {projects.map((group) => (
            <section key={group.project} className="project-group">
              <h2>{group.project}</h2>
              {group.consoles.length === 0 ? <div className="empty-project">No consoles</div> : null}
              {group.consoles.map((item) => (
                <button key={item.id} className={`console-row ${item.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(item.id)}>
                  <span className="status">{item.status === "running" ? "◷" : item.status === "ready" ? ">" : item.status === "detached" ? "!" : "×"}</span>
                  <span className="console-title">{item.name}</span>
                  {item.unseenErrorCount > 0 ? <span className="badge">{item.unseenErrorCount}</span> : null}
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>
      <section className="workspace">
        {selected ? <TerminalPane consoleRecord={selected} onChanged={refresh} /> : <div className="blank">Select or create a console</div>}
      </section>
      <Dialog store={dialog} className="dialog" backdrop={<div className="backdrop" />}>
        <DialogHeading className="dialog-title">Create console</DialogHeading>
        <label>
          Command
          <input id="console-command" name="command" value={command} onChange={(event) => setCommand(event.target.value)} />
        </label>
        <label>
          Working directory
          <input id="console-cwd" name="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Current yconhost directory" />
        </label>
        <div className="dialog-actions">
          <DialogDismiss className="secondary-button">Cancel</DialogDismiss>
          <Button className="primary-button" onClick={createConsole}>
            Create
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function TerminalPane({ consoleRecord, onChanged }: { consoleRecord: ConsoleRecord; onChanged: () => Promise<void> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: consoleRecord.mode === "managed",
      convertEol: true,
      scrollback: 5000,
      theme: { background: "#111316", foreground: "#e8ecef" }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current!);
    const helperTextarea = hostRef.current?.querySelector(".xterm-helper-textarea");
    helperTextarea?.setAttribute("id", `terminal-input-${consoleRecord.id}`);
    helperTextarea?.setAttribute("name", "terminalInput");
    fit.fit();
    terminalRef.current = terminal;

    fetch(`/api/consoles/${consoleRecord.id}/output`)
      .then((response) => response.json())
      .then((data: { output: string }) => terminal.write(data.output));

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socketRef.current = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type: string; consoleId: string; chunk: string };
      if (message.type === "output" && message.consoleId === consoleRecord.id) {
        terminal.write(message.chunk);
      }
    });
    terminal.onData((data) => {
      if (consoleRecord.mode === "managed" && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", consoleId: consoleRecord.id, data }));
      }
    });

    const resize = () => fit.fit();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      socket.close();
      terminal.dispose();
    };
  }, [consoleRecord.id, consoleRecord.mode]);

  async function post(path: string, body: unknown = {}) {
    await fetch(`/api/consoles/${consoleRecord.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    await onChanged();
  }

  return (
    <div className="terminal-layout">
      <header className="toolbar">
        <div>
          <h2>{consoleRecord.name}</h2>
          <p>{consoleRecord.cwd}</p>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => post("vanilla", { visible: !consoleRecord.vanillaVisible })}>{consoleRecord.vanillaVisible ? "Hide vanilla" : "Show vanilla"}</button>
          <button onClick={() => post("mode", { mode: consoleRecord.mode === "managed" ? "manual" : "managed" })}>
            {consoleRecord.mode === "managed" ? "Managed" : "Manual"}
          </button>
          <button onClick={() => post("signal", { signal: "ctrl+c" })}>Ctrl+C</button>
          <button onClick={() => post("restart")}>Restart</button>
        </div>
      </header>
      {consoleRecord.mode === "manual" ? <div className="readonly-banner">Manual mode: web input is read-only</div> : null}
      {!consoleRecord.attached ? <div className="readonly-banner">Detached: restart this console to attach a new live session</div> : null}
      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
