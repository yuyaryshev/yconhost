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
  projectPath?: string;
  cwd: string;
  command: string;
  noRun?: boolean;
  autoStartOnOpen?: boolean;
  status: "idle" | "starting" | "running" | "ready" | "exited";
  errorCount: number;
  unseenErrorCount: number;
  updatedAt: string;
  background?: string;
  backgroundColor?: { dark: string; light: string };
  pid?: number;
  readonly?: boolean;
  source?: "managed" | "pm2";
};

type MywinsEntry = {
  name: string;
  cmd?: string;
  command?: string;
  cwd?: string;
  no_run?: boolean;
  ansiParserEnabled?: boolean;
  background?: string;
};

type ErrorMatch = {
  id: string;
  createdAt: string;
  line: string;
  reason: string;
};

type ExtractedCard = {
  id: string;
  kind: "persistent" | "temporary";
  category: "error" | "warning" | "info" | "message";
  title: string;
  message: string;
  createdAt: string;
};

type ConsoleSnapshot = ConsoleRecord & {
  outputTail: string;
  errorMatches: ErrorMatch[];
  cards: ExtractedCard[];
};

type RecentProject = {
  path: string;
  name: string;
  openedAt: string;
};

type AppSettings = {
  host: string;
  port: number;
  dataDir: string;
  defaultShell: string;
  terminal: { cols: number; rows: number; scrollback: number };
  log: { maxBytes: number; rotateFiles: number; scrollbackBytes: number };
  cards: { maxPerConsole: number; scanTailBytes: number };
  codexContexts: { projectName: string; contextsPath: string; weztermPresetsPath?: string };
};

type AppTheme = "dark" | "light";
type SeverityFilter = "info" | "warning" | "error";

const terminalThemes: Record<AppTheme, { background: string; foreground: string; cursor: string; selectionBackground: string }> = {
  dark: { background: "#111316", foreground: "#e8ecef", cursor: "#e8ecef", selectionBackground: "#3b4652" },
  light: { background: "#ffffff", foreground: "#1c2329", cursor: "#1c2329", selectionBackground: "#c8d8e8" }
};

function App() {
  const [consoles, setConsoles] = useState<ConsoleRecord[]>([]);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [shellChoice, setShellChoice] = useState("cmd.exe");
  const [customShell, setCustomShell] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => (window.localStorage.getItem("yconhost-theme") === "light" ? "light" : "dark"));
  const [debugMode, setDebugMode] = useState(false);
  const [settings, setSettings] = useState<AppSettings>();
  const [serverAlive, setServerAlive] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set(["pm2"]));
  const advancedDialog = useDialogStore();
  const folderDialog = useDialogStore();
  const preferencesDialog = useDialogStore();
  const mywinsDialog = useDialogStore();
  const addMywinsDialog = useDialogStore();
  const [mywinsConsoleId, setMywinsConsoleId] = useState<string>();
  const [addMywinsProject, setAddMywinsProject] = useState<string>();
  const selected = consoles.find((item) => item.id === selectedId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("yconhost-theme", theme);
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    async function checkHealth() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 250);
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!disposed) setServerAlive(response.ok);
      } catch {
        if (!disposed) setServerAlive(false);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void checkHealth();
    const timer = window.setInterval(checkHealth, 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  async function refresh() {
    const response = await fetch("/api/consoles");
    const data = (await response.json()) as { consoles: ConsoleRecord[] };
    setConsoles(data.consoles);
    setSelectedId((current) => (current && data.consoles.some((item) => item.id === current) ? current : data.consoles[0]?.id));
  }

  async function refreshRecentProjects() {
    const response = await fetch("/api/recent-projects");
    const data = (await response.json()) as { projects: RecentProject[] };
    setRecentProjects(data.projects);
  }

  async function refreshSettings() {
    const response = await fetch("/api/settings");
    const data = (await response.json()) as { settings: AppSettings };
    setSettings(data.settings);
  }

  useEffect(() => {
    refresh();
    refreshRecentProjects();
    refreshSettings();
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
      const errorBody = (await batchResponse.json().catch(() => ({}))) as { error?: string };
      if (errorBody.error && !errorBody.error.startsWith("No mywins.json")) {
        window.alert(errorBody.error);
        return;
      }
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
    await refreshRecentProjects();
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
      await refresh();
    }
  }

  async function markConsoleRead(id: string) {
    const response = await fetch(`/api/consoles/${id}/read`, { method: "POST" });
    if (response.ok) await refresh();
  }

  async function closeProject(project: string) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project)}`, { method: "DELETE" });
    if (response.ok) await refresh();
  }

  async function runProjectAction(project: string, action: "restart" | "restart-except-no-run" | "stop" | "start" | "reload" | "read") {
    const response = await fetch(`/api/projects/${encodeURIComponent(project)}/${action}`, { method: "POST" });
    if (response.ok) await refresh();
  }

  async function importCodexContexts() {
    const response = await fetch("/api/codex-contexts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      window.alert(body.error ?? "Failed to import Codex contexts");
      return;
    }
    const result = (await response.json()) as { project: string; imported: number; consoles: ConsoleRecord[] };
    setMenuOpen(false);
    setThemeMenuOpen(false);
    setCollapsedProjects((current) => {
      const next = new Set(current);
      next.delete(result.project);
      return next;
    });
    setSelectedId(result.consoles[0]?.id);
    await refresh();
  }

  function openAddMywins(project: string) {
    setAddMywinsProject(project);
    addMywinsDialog.show();
  }

  function openEditMywins(id: string) {
    setMywinsConsoleId(id);
    mywinsDialog.show();
  }

  async function saveConsoleMywins(id: string, entry: MywinsEntry) {
    const response = await fetch(`/api/consoles/${id}/mywins`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      window.alert(body.error ?? "Failed to save mywins.json");
      return;
    }
    mywinsDialog.hide();
    await refresh();
  }

  async function addConsoleToMywins(project: string, entry: MywinsEntry) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project)}/mywins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      window.alert(body.error ?? "Failed to update mywins.json");
      return;
    }
    addMywinsDialog.hide();
    await refresh();
  }

  async function deleteConsoleFromMywins(id: string) {
    if (!window.confirm("Delete this console from mywins.json?")) return;
    const response = await fetch(`/api/consoles/${id}/mywins`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      window.alert(body.error ?? "Failed to delete from mywins.json");
      return;
    }
    await refresh();
  }

  async function removeRecentProject(projectPath: string) {
    const response = await fetch("/api/recent-projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath })
    });
    if (response.ok) await refreshRecentProjects();
  }

  const projects = useMemo(() => {
    const names = new Set(["Default", ...consoles.map((item) => item.project)]);
    return [...names].map((project) => ({ project, consoles: consoles.filter((item) => item.project === project) }));
  }, [consoles]);
  const filteredRecentProjects = useMemo(() => {
    const query = folderPath.trim().toLowerCase();
    if (!query) return recentProjects;
    return recentProjects.filter((project) => project.path.toLowerCase().includes(query) || project.name.toLowerCase().includes(query));
  }, [folderPath, recentProjects]);
  const toggleProjectCollapsed = (project: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(project)) {
        next.delete(project);
      } else {
        next.add(project);
      }
      return next;
    });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>
            <span className={`server-status-dot ${serverAlive ? "alive" : "dead"}`} title={serverAlive ? "Server online" : "Server offline"} />
            yconhost
          </h1>
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
                      setDebugMode((value) => !value);
                      setMenuOpen(false);
                      setThemeMenuOpen(false);
                    }}
                  >
                    {debugMode ? "Disable debug mode" : "Enable debug mode"}
                  </button>
                  <button onClick={() => setThemeMenuOpen((value) => !value)}>Themes</button>
                  {themeMenuOpen ? (
                    <div className="submenu">
                      <button
                        className={theme === "dark" ? "active-menu-item" : ""}
                        onClick={() => {
                          setTheme("dark");
                          setMenuOpen(false);
                          setThemeMenuOpen(false);
                        }}
                      >
                        Dark
                      </button>
                      <button
                        className={theme === "light" ? "active-menu-item" : ""}
                        onClick={() => {
                          setTheme("light");
                          setMenuOpen(false);
                          setThemeMenuOpen(false);
                        }}
                      >
                        Light
                      </button>
                    </div>
                  ) : null}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setThemeMenuOpen(false);
                      advancedDialog.show();
                    }}
                  >
                    Create...
                  </button>
                  <button onClick={() => void importCodexContexts()}>Import Codex contexts</button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setThemeMenuOpen(false);
                      preferencesDialog.show();
                    }}
                  >
                    Preferences
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="project-list">
          {projects.map((group) => (
            <section key={group.project} className="project-group">
              <ProjectHeader
                project={group.project}
                collapsed={collapsedProjects.has(group.project)}
                readonly={group.project === "pm2"}
                canReload={group.consoles.some((item) => item.projectPath)}
                onToggleCollapsed={() => toggleProjectCollapsed(group.project)}
                onClose={closeProject}
                onRestart={() => runProjectAction(group.project, "restart")}
                onRestartExceptNoRun={() => runProjectAction(group.project, "restart-except-no-run")}
                onStop={() => runProjectAction(group.project, "stop")}
                onStart={() => runProjectAction(group.project, "start")}
                onReload={() => runProjectAction(group.project, "reload")}
                onMarkRead={() => runProjectAction(group.project, "read")}
                onAddConsole={() => openAddMywins(group.project)}
              />
              {!collapsedProjects.has(group.project) ? (
                <>
                  {group.consoles.length === 0 ? <div className="empty-project">No consoles</div> : null}
                  {group.consoles.map((item) => (
                    <ConsoleRow key={item.id} item={item} active={item.id === selectedId} theme={theme} onSelect={() => setSelectedId(item.id)} onClose={closeConsole} />
                  ))}
                </>
              ) : null}
            </section>
          ))}
        </div>
      </aside>
      <section className="workspace">
        {selected ? (
          <TerminalPane
            consoleRecord={selected}
            debugMode={debugMode}
            theme={theme}
            onChanged={refresh}
            onRename={renameConsole}
            onClose={() => closeConsole(selected.id)}
            onMarkRead={() => markConsoleRead(selected.id)}
            onEditConfig={() => openEditMywins(selected.id)}
            onDeleteConfig={() => deleteConsoleFromMywins(selected.id)}
          />
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
        <div className="recent-projects">
          {filteredRecentProjects.length === 0 ? <div className="recent-empty">No recent projects</div> : null}
          {filteredRecentProjects.map((project) => (
            <RecentProjectRow
              key={project.path}
              project={project}
              onSelect={() => setFolderPath(project.path)}
              onClose={async () => {
                await closeProject(project.name);
                await removeRecentProject(project.path);
              }}
            />
          ))}
        </div>
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

      {settings ? (
        <PreferencesDialog
          dialog={preferencesDialog}
          settings={settings}
          onSave={async (next) => {
            const response = await fetch("/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: next })
            });
            const data = (await response.json()) as { settings: AppSettings };
            setSettings(data.settings);
            preferencesDialog.hide();
          }}
        />
      ) : null}
      {mywinsConsoleId ? (
        <MywinsEntryDialog
          dialog={mywinsDialog}
          title="Console settings"
          loadUrl={`/api/consoles/${mywinsConsoleId}/mywins`}
          onSave={(entry) => saveConsoleMywins(mywinsConsoleId, entry)}
        />
      ) : null}
      {addMywinsProject ? (
        <MywinsEntryDialog
          dialog={addMywinsDialog}
          title="Add console"
          initial={{ name: "", cmd: "", cwd: "", background: "" }}
          onSave={(entry) => addConsoleToMywins(addMywinsProject, entry)}
        />
      ) : null}
    </main>
  );
}

function MywinsEntryDialog({
  dialog,
  title,
  loadUrl,
  initial,
  onSave
}: {
  dialog: ReturnType<typeof useDialogStore>;
  title: string;
  loadUrl?: string;
  initial?: MywinsEntry;
  onSave: (entry: MywinsEntry) => Promise<void>;
}) {
  const empty: MywinsEntry = { name: "", cmd: "", cwd: "", background: "", no_run: false, ansiParserEnabled: true };
  const [draft, setDraft] = useState<MywinsEntry>(initial ?? empty);

  useEffect(() => {
    if (!loadUrl) {
      setDraft(initial ?? empty);
      return;
    }
    fetch(loadUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load mywins.json entry");
        return response.json();
      })
      .then((entry: MywinsEntry) => setDraft({ ...empty, ...entry, cmd: entry.cmd ?? entry.command ?? "" }))
      .catch((error: Error) => window.alert(error.message));
  }, [loadUrl]);

  return (
    <Dialog store={dialog} className="dialog preferences-dialog" backdrop={<div className="backdrop" />}>
      <DialogHeading className="dialog-title">{title}</DialogHeading>
      <div className="settings-grid">
        <label>
          Name
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          Background
          <input value={draft.background ?? ""} placeholder="STD_RED, STD_YELLOW, rgb(12, 20, 20), #111316" onChange={(event) => setDraft((current) => ({ ...current, background: event.target.value }))} />
        </label>
        <label>
          Working directory
          <input value={draft.cwd ?? ""} onChange={(event) => setDraft((current) => ({ ...current, cwd: event.target.value }))} />
        </label>
        <label>
          Command
          <input value={draft.cmd ?? ""} onChange={(event) => setDraft((current) => ({ ...current, cmd: event.target.value }))} />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={draft.no_run === true} onChange={(event) => setDraft((current) => ({ ...current, no_run: event.target.checked }))} />
          no_run
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={draft.ansiParserEnabled !== false} onChange={(event) => setDraft((current) => ({ ...current, ansiParserEnabled: event.target.checked }))} />
          ANSI parser
        </label>
      </div>
      <div className="dialog-actions">
        <DialogDismiss className="secondary-button">Cancel</DialogDismiss>
        <Button className="primary-button" onClick={() => void onSave(draft)}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function PreferencesDialog({ dialog, settings, onSave }: { dialog: ReturnType<typeof useDialogStore>; settings: AppSettings; onSave: (settings: AppSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => setDraft(settings), [settings]);

  function setNumber(path: "terminal.cols" | "terminal.rows" | "terminal.scrollback" | "log.maxBytes" | "log.rotateFiles" | "log.scrollbackBytes" | "cards.maxPerConsole" | "cards.scanTailBytes", value: string) {
    const parsed = Math.max(0, Number(value) || 0);
    const [section, key] = path.split(".") as [keyof AppSettings, string];
    setDraft((current) => ({
      ...current,
      [section]: {
        ...(current[section] as object),
        [key]: parsed
      }
    }));
  }

  return (
    <Dialog store={dialog} className="dialog preferences-dialog" backdrop={<div className="backdrop" />}>
      <DialogHeading className="dialog-title">Preferences</DialogHeading>
      <div className="settings-grid">
        <label>
          Terminal columns
          <input value={draft.terminal.cols} type="number" min={20} onChange={(event) => setNumber("terminal.cols", event.target.value)} />
        </label>
        <label>
          Terminal rows
          <input value={draft.terminal.rows} type="number" min={5} onChange={(event) => setNumber("terminal.rows", event.target.value)} />
        </label>
        <label>
          Terminal scrollback
          <input value={draft.terminal.scrollback} type="number" min={0} onChange={(event) => setNumber("terminal.scrollback", event.target.value)} />
        </label>
        <label>
          Log max bytes
          <input value={draft.log.maxBytes} type="number" min={1048576} step={1048576} onChange={(event) => setNumber("log.maxBytes", event.target.value)} />
        </label>
        <label>
          Log rotations
          <input value={draft.log.rotateFiles} type="number" min={1} onChange={(event) => setNumber("log.rotateFiles", event.target.value)} />
        </label>
        <label>
          UI scrollback bytes
          <input value={draft.log.scrollbackBytes} type="number" min={65536} step={65536} onChange={(event) => setNumber("log.scrollbackBytes", event.target.value)} />
        </label>
        <label>
          Max cards
          <input value={draft.cards.maxPerConsole} type="number" min={0} onChange={(event) => setNumber("cards.maxPerConsole", event.target.value)} />
        </label>
        <label>
          Card scan bytes
          <input value={draft.cards.scanTailBytes} type="number" min={65536} step={65536} onChange={(event) => setNumber("cards.scanTailBytes", event.target.value)} />
        </label>
      </div>
      <div className="dialog-actions">
        <DialogDismiss className="secondary-button">Cancel</DialogDismiss>
        <Button className="primary-button" onClick={() => void onSave(draft)}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function ProjectHeader({
  project,
  collapsed,
  readonly,
  canReload,
  onToggleCollapsed,
  onClose,
  onRestart,
  onRestartExceptNoRun,
  onStop,
  onStart,
  onReload,
  onMarkRead,
  onAddConsole
}: {
  project: string;
  collapsed: boolean;
  readonly?: boolean;
  canReload?: boolean;
  onToggleCollapsed: () => void;
  onClose: (project: string) => Promise<void>;
  onRestart: () => Promise<void>;
  onRestartExceptNoRun: () => Promise<void>;
  onStop: () => Promise<void>;
  onStart: () => Promise<void>;
  onReload: () => Promise<void>;
  onMarkRead: () => Promise<void>;
  onAddConsole: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="project-header">
      <button className="project-collapse-button" onClick={onToggleCollapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${project}`}>
        <span>{collapsed ? ">" : "v"}</span>
        <h2>{project}</h2>
      </button>
      {!readonly ? <div className="menu-wrap">
        <button className="project-menu-button" title={`Project actions for ${project}`} aria-label={`Project actions for ${project}`} onClick={() => setOpen((value) => !value)}>
          <MenuIcon />
        </button>
        {open ? (
          <div className="dropdown-menu project-dropdown">
            <button onClick={() => void onRestart()}>Restart all</button>
            <button onClick={() => void onRestartExceptNoRun()}>Restart except no_run</button>
            <button onClick={() => void onStop()}>Stop all</button>
            <button onClick={() => void onStart()}>Start all</button>
            {canReload ? <button onClick={onAddConsole}>Add console...</button> : null}
            {canReload ? <button onClick={() => void onReload()}>Reload mywins.json</button> : null}
            <button onClick={() => void onMarkRead()}>All read</button>
            <button onClick={() => void onClose(project)}>Close</button>
          </div>
        ) : null}
      </div> : null}
    </div>
  );
}

function RecentProjectRow({ project, onSelect, onClose }: { project: RecentProject; onSelect: () => void; onClose: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="recent-project-row">
      <button className="recent-project-main" onClick={onSelect}>
        <span>{project.name}</span>
        <small>{project.path}</small>
      </button>
      <div className="menu-wrap">
        <button className="project-menu-button" title={`Actions for ${project.name}`} aria-label={`Actions for ${project.name}`} onClick={() => setOpen((value) => !value)}>
          <MenuIcon />
        </button>
        {open ? (
          <div className="dropdown-menu recent-dropdown">
            <button onClick={() => void onClose()}>Close</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConsoleRow({
  item,
  active,
  theme,
  onSelect,
  onClose
}: {
  item: ConsoleRecord;
  active: boolean;
  theme: AppTheme;
  onSelect: () => void;
  onClose: (id: string) => Promise<void>;
}) {
  const showErrorBadge = item.status !== "idle" && item.status !== "exited" && item.unseenErrorCount > 0;
  const canClose = !item.readonly && item.status !== "idle" && item.status !== "exited";
  const labelColor = item.backgroundColor?.[theme] ?? item.background;
  return (
    <div className={`console-row ${active ? "active" : ""}`} style={{ "--console-label-bg": labelColor } as React.CSSProperties} onClick={onSelect}>
      <span className={`status ${item.status}`}>{consoleStatusGlyph(item.status)}</span>
      <span className="console-title">{item.name}</span>
      {showErrorBadge ? <span className="badge">{item.unseenErrorCount}</span> : null}
      {canClose ? (
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
      ) : null}
    </div>
  );
}

function consoleStatusMark(status: ConsoleRecord["status"]): string {
  if (status === "running") return "*";
  if (status === "ready") return ">";
  if (status === "starting") return ".";
  if (status === "exited") return "✓";
  return "•";
}

function consoleStatusGlyph(status: ConsoleRecord["status"]): string {
  if (status === "exited") return "\u2713";
  if (status === "idle") return "\u2022";
  return consoleStatusMark(status);
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
  debugMode,
  theme,
  onChanged,
  onRename,
  onClose,
  onMarkRead,
  onEditConfig,
  onDeleteConfig
}: {
  consoleRecord: ConsoleRecord;
  debugMode: boolean;
  theme: AppTheme;
  onChanged: () => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onClose: () => Promise<void>;
  onMarkRead: () => Promise<void>;
  onEditConfig: () => void;
  onDeleteConfig: () => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState<ExtractedCard[]>([]);
  const [cardsCollapsed, setCardsCollapsed] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("info");
  const [atTerminal, setAtTerminal] = useState(true);
  const [consoleMenuOpen, setConsoleMenuOpen] = useState(false);
  const isReadonly = consoleRecord.readonly === true;
  const canRestart = !isReadonly && consoleRecord.status !== "idle" && consoleRecord.status !== "exited";
  const terminalBackground = consoleRecord.backgroundColor?.[theme] ?? terminalThemes[theme].background;

  const filteredCards = cards.filter((card) => severityRank(card.category) >= severityRank(severityFilter));
  const cardCounts = cards.reduce(
    (acc, card) => {
      acc[card.category] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0, message: 0 }
  );

  function scrollToTerminal(behavior: ScrollBehavior = "smooth") {
    hostRef.current?.scrollIntoView({ block: "end", behavior });
  }

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      ignoreBracketedPasteMode: true,
      scrollback: 0,
      theme: { ...terminalThemes[theme], background: terminalBackground }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current!);
    const wheelToPage = (event: WheelEvent) => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollTop += event.deltaY;
      event.preventDefault();
    };
    hostRef.current?.addEventListener("wheel", wheelToPage, { passive: false });
    const helperTextarea = hostRef.current?.querySelector(".xterm-helper-textarea");
    helperTextarea?.setAttribute("id", `terminal-input-${consoleRecord.id}`);
    helperTextarea?.setAttribute("name", "terminalInput");
    fit.fit();
    terminalRef.current = terminal;

    fetch(`/api/consoles/${consoleRecord.id}/output`)
      .then((response) => response.json())
      .then((data: { output: string }) => terminal.write(data.output, () => window.setTimeout(() => scrollToTerminal("auto"), 0)));

    fetch(`/api/consoles/${consoleRecord.id}`)
      .then((response) => response.json())
      .then((data: ConsoleSnapshot) => setCards(data.cards ?? []));

    const sendInput = (data: string) => {
      if (isReadonly) return;
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "input", consoleId: consoleRecord.id, data }));
      } else {
        void fetch(`/api/consoles/${consoleRecord.id}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data })
        });
      }
    };
    terminal.onData(sendInput);

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    let disposed = false;
    let reconnectTimer: number | undefined;
    const connectSocket = () => {
      if (disposed) return;
      const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data) as { type: string; consoleId: string; chunk: string };
        if (message.type === "output" && message.consoleId === consoleRecord.id) {
          terminal.write(message.chunk);
        }
      });
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "subscribe", consoleId: consoleRecord.id }));
        sendResize();
      });
      socket.addEventListener("close", () => {
        if (!disposed) reconnectTimer = window.setTimeout(connectSocket, 300);
      });
      socket.addEventListener("error", () => socket.close());
    };

    function sendResize() {
      fit.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", consoleId: consoleRecord.id, cols: terminal.cols, rows: terminal.rows }));
      }
    }
    connectSocket();
    window.addEventListener("resize", sendResize);
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.removeEventListener("resize", sendResize);
      socketRef.current?.close();
      hostRef.current?.removeEventListener("wheel", wheelToPage);
      terminal.dispose();
    };
  }, [consoleRecord.id, theme, isReadonly, terminalBackground]);

  useEffect(() => {
    if (!isReadonly || !terminalRef.current) return;
    fetch(`/api/consoles/${consoleRecord.id}/output`)
      .then((response) => response.json())
      .then((data: { output: string }) => {
        terminalRef.current?.reset();
        terminalRef.current?.write(data.output, () => window.setTimeout(() => scrollToTerminal("auto"), 0));
      });
  }, [consoleRecord.id, consoleRecord.updatedAt, isReadonly]);

  useEffect(() => {
    window.setTimeout(() => scrollToTerminal("auto"), 0);
  }, [consoleRecord.id]);

  useEffect(() => {
    fetch(`/api/consoles/${consoleRecord.id}`)
      .then((response) => response.json())
      .then((data: ConsoleSnapshot) => setCards(data.cards ?? []));
  }, [consoleRecord.id, consoleRecord.errorCount]);

  function updateScrollState() {
    const node = scrollRef.current;
    if (!node) return;
    setAtTerminal(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
  }

  async function post(path: string, body: unknown = {}) {
    await fetch(`/api/consoles/${consoleRecord.id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    await onChanged();
  }

  return (
    <div className="terminal-layout" style={{ "--terminal-bg": terminalBackground } as React.CSSProperties}>
      <header className="toolbar">
        <div className="toolbar-main">
          <div>
            <EditableConsoleHeading consoleRecord={consoleRecord} onRename={onRename} />
            <p>
              <span>{consoleRecord.cwd}</span>
              {consoleRecord.pid ? <span className="meta-pill">PID {consoleRecord.pid}</span> : null}
            </p>
          </div>
          {!isReadonly ? (
            <div className="toolbar-actions">
              <button onClick={onMarkRead}>Mark read</button>
              <button onClick={() => post("signal", { signal: "ctrl+c" })}>Ctrl+C</button>
              <button onClick={() => post(canRestart ? "restart" : "start")}>{canRestart ? "Restart" : "Start"}</button>
              {consoleRecord.status !== "idle" && consoleRecord.status !== "exited" ? <button onClick={onClose}>Close</button> : null}
              {consoleRecord.projectPath ? (
                <div className="menu-wrap">
                  <button className="project-menu-button" title="Console actions" aria-label="Console actions" onClick={() => setConsoleMenuOpen((value) => !value)}>
                    <MenuIcon />
                  </button>
                  {consoleMenuOpen ? (
                    <div className="dropdown-menu detail-dropdown">
                      <button
                        onClick={() => {
                          setConsoleMenuOpen(false);
                          onEditConfig();
                        }}
                      >
                        Settings...
                      </button>
                      <button
                        onClick={() => {
                          setConsoleMenuOpen(false);
                          void onDeleteConfig();
                        }}
                      >
                        Delete from mywins.json
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="cards-toolbar">
          <button className="cards-toggle" onClick={() => setCardsCollapsed((value) => !value)}>
            Cards
          </button>
          <button className={severityFilter === "error" ? "active-filter error" : "error"} onClick={() => setSeverityFilter("error")}>
            Errors {cardCounts.error}
          </button>
          <button className={severityFilter === "warning" ? "active-filter warning" : "warning"} onClick={() => setSeverityFilter("warning")}>
            Warnings {cardCounts.warning}
          </button>
          <button className={severityFilter === "info" ? "active-filter info" : "info"} onClick={() => setSeverityFilter("info")}>
            Info {cardCounts.info}
          </button>
        </div>
      </header>
      <div className="console-scroll" ref={scrollRef} onScroll={updateScrollState}>
        {!cardsCollapsed ? <CardsPanel cards={filteredCards} /> : null}
        <div className="terminal-stage">
          <div ref={hostRef} className="terminal-host" />
          {!isReadonly && !canRestart ? <DisabledConsoleOverlay consoleRecord={consoleRecord} /> : null}
        </div>
        {debugMode ? <ErrorDebugPanel matches={cards.map((card) => ({ id: card.id, createdAt: card.createdAt, line: card.title, reason: `${card.kind} ${card.category}` }))} /> : null}
        {!atTerminal ? (
          <button className="scroll-terminal-button" onClick={() => scrollToTerminal()} title="Scroll to terminal" aria-label="Scroll to terminal">
            v
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DisabledConsoleOverlay({ consoleRecord }: { consoleRecord: ConsoleRecord }) {
  return (
    <div className="disabled-console-overlay">
      <div className="disabled-console-panel">
        <div className="disabled-console-label">Command</div>
        <pre>{consoleRecord.command}</pre>
      </div>
    </div>
  );
}

function CardsPanel({ cards }: { cards: ExtractedCard[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  return (
    <section className="cards-panel">
      {cards.length > 0 ? (
        <div className="cards-list">
          {cards.map((card) => {
            const isExpanded = expanded.has(card.id);
            const canExpand = card.message.length > 240 || card.message.split("\n").length > 5;
            return (
              <article key={card.id} className={`message-card ${card.category} ${isExpanded ? "expanded" : ""}`}>
                <pre>{card.message}</pre>
                {canExpand ? (
                  <button
                    className="card-expand-button"
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(card.id)) {
                          next.delete(card.id);
                        } else {
                          next.add(card.id);
                        }
                        return next;
                      })
                    }
                    title={isExpanded ? "Collapse" : "Show full"}
                    aria-label={isExpanded ? "Collapse card" : "Show full card"}
                  >
                    {isExpanded ? "^" : "v"}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function severityRank(category: ExtractedCard["category"] | SeverityFilter): number {
  if (category === "error") return 3;
  if (category === "warning") return 2;
  return 1;
}

function ErrorDebugPanel({ matches }: { matches: ErrorMatch[] }) {
  return (
    <section className="debug-panel">
      <h3>Error matches</h3>
      {matches.length === 0 ? <div className="debug-empty">No matches</div> : null}
      {matches.map((match) => (
        <article key={match.id} className="debug-match">
          <div>{match.line}</div>
          <small>
            {match.reason} - {new Date(match.createdAt).toLocaleTimeString()}
          </small>
        </article>
      ))}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
