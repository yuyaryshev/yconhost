import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Dialog, DialogDismiss, DialogHeading, useDialogStore } from "@ariakit/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

type ConsoleRecord = {
  id: string;
  name: string;
  project: string;
  cwd: string;
  command: string;
  status: "starting" | "running" | "ready" | "exited";
  errorCount: number;
  unseenErrorCount: number;
  pid?: number;
};

function App() {
  const [consoles, setConsoles] = useState<ConsoleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [shellChoice, setShellChoice] = useState("cmd.exe");
  const [customShell, setCustomShell] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const advancedDialog = useDialogStore();
  const folderDialog = useDialogStore();
  const selected = consoles.find((item) => item.id === selectedId);

  async function refresh() {
    const response = await fetch("/api/consoles");
    const data = (await response.json()) as { consoles: ConsoleRecord[] };
    setConsoles(data.consoles);
    setSelectedId((current) => (current && data.consoles.some((item) => item.id === current) ? current : data.consoles[0]?.id));
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);

  async function createDefaultConsole() {
    const response = await fetch("/api/consoles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shell: "cmd.exe", name: "cmd.exe" })
    });
    const created = (await response.json()) as ConsoleRecord;
    setSelectedId(created.id);
    await refresh();
  }

  async function createAdvancedConsole() {
    const shell = shellChoice === "other" ? customShell.trim() : shellChoice;
    if (!shell) return;

    const response = await fetch("/api/consoles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shell,
        command: command.trim() || undefined,
        cwd: cwd.trim() || undefined,
        name: command.trim() || shell
      })
    });
    const created = (await response.json()) as ConsoleRecord;
    setSelectedId(created.id);
    setMenuOpen(false);
    advancedDialog.hide();
    await refresh();
  }

  async function openFolderConsole() {
    const target = folderPath.trim();
    if (!target) return;

    const batchResponse = await fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: target })
    });

    if (batchResponse.ok) {
      const created = (await batchResponse.json()) as ConsoleRecord[];
      setSelectedId(created[0]?.id);
    } else {
      const response = await fetch("/api/consoles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shell: "cmd.exe",
          cwd: target,
          name: target.split(/[\\/]/).filter(Boolean).at(-1) ?? "cmd.exe"
        })
      });
      const created = (await response.json()) as ConsoleRecord;
      setSelectedId(created.id);
    }

    folderDialog.hide();
    await refresh();
  }

  async function renameConsole(id: string, name: string) {
    const response = await fetch(`/api/consoles/${id}/name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      await refresh();
    }
  }

  async function closeConsole(id: string) {
    const response = await fetch(`/api/consoles/${id}`, { method: "DELETE" });
    if (response.ok) {
      setSelectedId((current) => (current === id ? undefined : current));
      await refresh();
    }
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
          <div className="header-actions">
            <Button className="icon-button" onClick={createDefaultConsole} title="Create cmd console">
              +
            </Button>
            <Button className="icon-button" onClick={folderDialog.show} title="Open folder or project" aria-label="Open folder or project">
              <FolderIcon />
            </Button>
            <div className="menu-wrap">
              <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} title="More" aria-label="More">
                <MenuIcon />
              </button>
              {menuOpen ? (
                <div className="dropdown-menu">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      advancedDialog.show();
                    }}
                  >
                    Create...
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="project-list">
          {projects.map((group) => (
            <section key={group.project} className="project-group">
              <h2>{group.project}</h2>
              {group.consoles.length === 0 ? <div className="empty-project">No consoles</div> : null}
              {group.consoles.map((item) => (
                <ConsoleRow key={item.id} item={item} active={item.id === selectedId} onSelect={() => setSelectedId(item.id)} onClose={closeConsole} />
              ))}
            </section>
          ))}
        </div>
      </aside>
      <section className="workspace">
        {selected ? (
          <TerminalPane consoleRecord={selected} onChanged={refresh} onRename={renameConsole} onClose={() => closeConsole(selected.id)} />
        ) : (
          <div className="blank">Select or create a console</div>
        )}
      </section>

      <Dialog store={folderDialog} className="dialog" backdrop={<div className="backdrop" />}>
        <DialogHeading className="dialog-title">Open folder</DialogHeading>
        <label>
          Working directory
          <input id="folder-path" name="folderPath" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <DialogDismiss className="secondary-button">Cancel</DialogDismiss>
          <Button className="primary-button" onClick={openFolderConsole}>
            Open
          </Button>
        </div>
      </Dialog>

      <Dialog store={advancedDialog} className="dialog" backdrop={<div className="backdrop" />}>
        <DialogHeading className="dialog-title">Create console</DialogHeading>
        <label>
          Shell
          <select id="console-shell" name="shell" value={shellChoice} onChange={(event) => setShellChoice(event.target.value)}>
            <option value="cmd.exe">cmd.exe</option>
            <option value="powershell.exe">powershell.exe</option>
            <option value="other">Other...</option>
          </select>
        </label>
        {shellChoice === "other" ? (
          <label>
            Executable
            <input id="console-custom-shell" name="customShell" value={customShell} onChange={(event) => setCustomShell(event.target.value)} />
          </label>
        ) : null}
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
          <Button className="primary-button" onClick={createAdvancedConsole}>
            Create
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function ConsoleRow({
  item,
  active,
  onSelect,
  onClose
}: {
  item: ConsoleRecord;
  active: boolean;
  onSelect: () => void;
  onClose: (id: string) => Promise<void>;
}) {
  return (
    <div className={`console-row ${active ? "active" : ""}`} onClick={onSelect}>
      <span className="status">{item.status === "running" ? "*" : item.status === "ready" ? ">" : "x"}</span>
      <span className="console-title">{item.name}</span>
      {item.unseenErrorCount > 0 ? <span className="badge">{item.unseenErrorCount}</span> : null}
      <button
        className="row-close-button"
        title="Close console"
        aria-label={`Close ${item.name}`}
        onClick={(event) => {
          event.stopPropagation();
          void onClose(item.id);
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l2 2h9v8a2 2 0 0 1-2 2h-15v-12Z" />
      <path d="M3.5 7.5v-1a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function EditableConsoleHeading({
  consoleRecord,
  onRename
}: {
  consoleRecord: ConsoleRecord;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(consoleRecord.name);

  useEffect(() => setValue(consoleRecord.name), [consoleRecord.name]);

  async function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== consoleRecord.name) {
      await onRename(consoleRecord.id, trimmed);
    } else {
      setValue(consoleRecord.name);
    }
  }

  if (editing) {
    return (
      <input
        className="detail-title-input"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") {
            setValue(consoleRecord.name);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button className="detail-title-button" onClick={() => setEditing(true)} title="Rename console">
      {consoleRecord.name}
    </button>
  );
}

function TerminalPane({
  consoleRecord,
  onChanged,
  onRename,
  onClose
}: {
  consoleRecord: ConsoleRecord;
  onChanged: () => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onClose: () => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
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
      if (socket.readyState === WebSocket.OPEN) {
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
  }, [consoleRecord.id]);

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
          <EditableConsoleHeading consoleRecord={consoleRecord} onRename={onRename} />
          <p>
            <span>{consoleRecord.cwd}</span>
            {consoleRecord.pid ? <span className="meta-pill">PID {consoleRecord.pid}</span> : null}
          </p>
        </div>
        <div className="toolbar-actions">
          <button onClick={() => post("signal", { signal: "ctrl+c" })}>Ctrl+C</button>
          <button onClick={() => post("restart")}>Restart</button>
          <button onClick={onClose}>Close</button>
        </div>
      </header>
      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
