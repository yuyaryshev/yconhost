import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Button, Dialog, DialogDismiss, DialogHeading, useDialogStore } from "@ariakit/react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { selectProjectConsoles } from "./projectConsoles.js";
import { isWindowsTerminalReply } from "./terminalInput.js";
import { unreadCards } from "./cards.js";
import type { NativeWindowState } from "../server/types.js";

type ConsoleRecord = {
  id: string;
  name: string;
  project: string;
  projectPath?: string;
  cwd: string;
  command: string;
  shell: string;
  noRun?: boolean;
  autoStartOnOpen?: boolean;
  status: "idle" | "starting" | "running" | "ready" | "exited";
  errorCount: number;
  unseenErrorCount: number;
  readCardHashes?: string[];
  gatherErrors?: boolean;
  gatherErrorsOverride?: boolean;
  updatedAt: string;
  lastStartedAt?: string;
  lastInputAt?: string;
  lastOutputAt?: string;
  background?: string;
  backgroundColor?: { dark: string; light: string };
  pid?: number;
  readonly?: boolean;
  source?: "managed" | "pm2";
  nativeCli?: NativeWindowState;
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
  hash: string;
  read?: boolean;
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
  terminal: { cols: number; rows: number; scrollback: number; host?: "standard" | "yopenconsole"; yopenconsolePath?: string };
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
  const [projectDefaults, setProjectDefaults] = useState<Record<string, boolean>>({});
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
  const knownProjects = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
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
    const intervalMs = 300;
    const timeoutMs = intervalMs * 2.2;
    let offlineTimer: number | undefined;
    const pending = new Set<AbortController>();
    async function checkHealth() {
      const controller = new AbortController();
      pending.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        if (!disposed && response.ok) {
          setServerAlive(true);
          window.clearTimeout(offlineTimer);
          offlineTimer = window.setTimeout(() => {
            if (!disposed) setServerAlive(false);
          }, timeoutMs);
        }
      } catch {
        // Only the silence deadline can mark the server offline, not an older failed ping.
      } finally {
        window.clearTimeout(timeout);
        pending.delete(controller);
      }
    }
    void checkHealth();
    const timer = window.setInterval(checkHealth, intervalMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.clearTimeout(offlineTimer);
      for (const controller of pending) controller.abort();
    };
  }, []);

  async function refresh() {
    const response = await fetch("/api/consoles");
    const data = (await response.json()) as { consoles: ConsoleRecord[] };
    setConsoles(data.consoles);
    const projectsResponse = await fetch("/api/projects");
    if (projectsResponse.ok) {
      const projectData = await projectsResponse.json() as { projects: Array<{ name: string; gatherErrors?: boolean }> };
      setProjectDefaults(Object.fromEntries(projectData.projects.map((project) => [project.name, project.gatherErrors !== false])));
    }
    const names = new Set(["Default", ...data.consoles.map((item) => item.project)]);
    const newNames = [...names].filter((name) => !knownProjects.current.has(name));
    if (names.size > 3 && newNames.length > 0) {
      setCollapsedProjects((current) => new Set([...current, ...newNames]));
    }
    knownProjects.current = names;
    setSelectedId((current) => (current && data.consoles.some((item) => item.id === current) ? current : data.consoles[0]?.id));
  }

  async function refreshRecentProjects() {
    const response = await fetch("/api/recent-projects");
    const data = (await response.json()) as { projects: RecentProject[] };
    setRecentProjects(data.projects);
  }

  async function setProjectGatherErrors(project: string, enabled: boolean) {
    const response = await fetch(`/api/projects/${encodeURIComponent(project)}/gather-errors`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
    });
    if (!response.ok) {
      window.alert((await response.json()).error ?? "Failed to update error gathering");
      return;
    }
    await refresh();
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
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      window.alert(body.error ?? "Failed to close console");
      return;
    }
    await refresh();
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
    const record = consoles.find((item) => item.id === id);
    if (!record?.projectPath) return;
    if (!window.confirm(`Delete "${record.name}" from the project's mywins.json?\nProject: ${record.projectPath}\nThe console will be removed and its running process, if any, stopped.`)) return;
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
      <header className="app-header">
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
        <div className="console-toolbar-slot" ref={setToolbarHost} />
      </header>
      <div className="console-scroll" ref={scrollRef}>
        <div className="app-body">
          <aside className="sidebar">
        <div className="project-list">
          {projects.map((group) => (
            <section key={group.project} className="project-group">
              <ProjectHeader
                project={group.project}
                collapsed={collapsedProjects.has(group.project)}
                readonly={group.project === "pm2"}
                canReload={group.consoles.some((item) => item.projectPath)}
                gatherErrors={projectDefaults[group.project] ?? true}
                onGatherErrors={(enabled) => setProjectGatherErrors(group.project, enabled)}
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
                <ProjectConsoleList consoles={group.consoles} selectedId={selectedId} theme={theme} onSelect={setSelectedId} onClose={closeConsole} onEditConfig={openEditMywins} onDeleteConfig={deleteConsoleFromMywins} />
              ) : null}
            </section>
          ))}
        </div>
      </aside>
      <section className="workspace">
        {selected ? (
          <TerminalPane
            consoleRecord={selected}
            toolbarHost={toolbarHost}
            scrollRef={scrollRef}
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
        </div>
      </div>

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
            const data = (await response.json()) as { settings: AppSettings; error?: string };
            if (!response.ok) throw new Error(data.error ?? "Failed to save settings");
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
      {error ? <div role="alert">{error}</div> : null}
      <div className="settings-grid">
        <label>
          Terminal columns
          <input value={draft.terminal.cols} type="number" min={20} onChange={(event) => setNumber("terminal.cols", event.target.value)} />
        </label>
        <label>
          Console host
          <select value={draft.terminal.host ?? "standard"} onChange={(event) => setDraft((current) => ({ ...current, terminal: { ...current.terminal, host: event.target.value as "standard" | "yopenconsole" } }))}>
            <option value="standard">Standard ConPTY</option>
            <option value="yopenconsole">yopenconsole</option>
          </select>
        </label>
        <label>
          yopenconsole executable
          <input value={draft.terminal.yopenconsolePath ?? ""} onChange={(event) => setDraft((current) => ({ ...current, terminal: { ...current.terminal, yopenconsolePath: event.target.value } }))} />
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
        <Button className="primary-button" disabled={saving} onClick={() => {
          setSaving(true);
          setError("");
          void onSave(draft).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setSaving(false));
        }}>
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
  gatherErrors,
  onGatherErrors,
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
  gatherErrors: boolean;
  onGatherErrors: (enabled: boolean) => Promise<void>;
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
            <label className="gather-errors-control project-gather-errors">
              <input type="checkbox" checked={gatherErrors} onChange={(event) => void onGatherErrors(event.target.checked)} />
              Gather errors by default
            </label>
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

function ProjectConsoleList({ consoles, selectedId, theme, onSelect, onClose, onEditConfig, onDeleteConfig }: {
  consoles: ConsoleRecord[];
  selectedId?: string;
  theme: AppTheme;
  onSelect: (id: string) => void;
  onClose: (id: string) => Promise<void>;
  onEditConfig: (id: string) => void;
  onDeleteConfig: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const isLarge = consoles.length > 10;
  const visible = selectProjectConsoles(consoles, query, showAll);
  return (
    <div className="project-consoles" data-large={isLarge}>
      {isLarge ? <input className="project-console-search" type="search" aria-label="Поиск консолей" placeholder="Поиск консолей" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
      {visible.length === 0 ? <div className="empty-project">{query ? "Ничего не найдено" : "Нет недавних запусков"}</div> : null}
      {visible.map((item) => <ConsoleRow key={item.id} item={item} active={item.id === selectedId} theme={theme} onSelect={() => onSelect(item.id)} onClose={onClose} onEditConfig={() => onEditConfig(item.id)} onDeleteConfig={() => onDeleteConfig(item.id)} />)}
      {isLarge && !showAll ? <button className="project-show-all" onClick={() => { setQuery(""); setShowAll(true); }}>Показать все</button> : null}
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

function ConsoleActionsMenu({ consoleRecord, onEditConfig, onDelete }: {
  consoleRecord: ConsoleRecord;
  onEditConfig: () => void;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap" onClick={(event) => event.stopPropagation()}>
      <button className="project-menu-button" title="Console actions" aria-label={`Console actions for ${consoleRecord.name}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MenuIcon />
      </button>
      {open ? (
        <div className="dropdown-menu detail-dropdown">
          {consoleRecord.projectPath ? <button onClick={() => { setOpen(false); onEditConfig(); }}>Settings...</button> : null}
          <button onClick={() => { setOpen(false); void onDelete(); }}>
            {consoleRecord.projectPath ? "Delete from mywins.json" : "Delete console"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConsoleRow({
  item,
  active,
  theme,
  onSelect,
  onClose,
  onEditConfig,
  onDeleteConfig
}: {
  item: ConsoleRecord;
  active: boolean;
  theme: AppTheme;
  onSelect: () => void;
  onClose: (id: string) => Promise<void>;
  onEditConfig: () => void;
  onDeleteConfig: () => Promise<void>;
}) {
  const showErrorBadge = item.status !== "idle" && item.status !== "exited" && item.unseenErrorCount > 0;
  const isDefault = item.project === "Default";
  const canClose = !item.readonly && (isDefault || (item.status !== "idle" && item.status !== "exited"));
  const labelColor = item.backgroundColor?.[theme] ?? item.background;
  return (
    <div className={`console-row ${active ? "active" : ""}`} style={{ "--console-label-bg": labelColor } as React.CSSProperties} onClick={onSelect}>
      <span className={`status ${item.status}`}>{consoleStatusGlyph(item.status)}</span>
      <span className="console-title">{item.name}</span>
      {showErrorBadge ? <span className="badge">{item.unseenErrorCount}</span> : null}
      <div className="console-row-actions">
        {canClose ? (
          <button
            className="row-close-button"
            title={isDefault ? "Delete console" : "Close console"}
            aria-label={`${isDefault ? "Delete" : "Close"} ${item.name}`}
            onClick={(event) => {
              event.stopPropagation();
              void onClose(item.id);
            }}
          >
            <CloseIcon />
          </button>
        ) : null}
        {!item.readonly && item.projectPath ? <ConsoleActionsMenu consoleRecord={item} onEditConfig={onEditConfig} onDelete={onDeleteConfig} /> : null}
      </div>
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
  toolbarHost,
  scrollRef,
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
  toolbarHost: HTMLDivElement | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
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
  const stageRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const loadedCardsConsole = useRef<string | null>(null);
  const [cards, setCards] = useState<ExtractedCard[]>([]);
  const [cardsCollapsed, setCardsCollapsed] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("info");
  const [atTerminal, setAtTerminal] = useState(true);
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeError, setNativeError] = useState("");
  const [gatherBusy, setGatherBusy] = useState(false);
  const [gatherError, setGatherError] = useState("");
  const nativeRef = useRef(consoleRecord.nativeCli);
  const fitRef = useRef<FitAddon | null>(null);
  const consoleIdRef = useRef(consoleRecord.id);
  consoleIdRef.current = consoleRecord.id;
  nativeRef.current = consoleRecord.nativeCli;
  const isReadonly = consoleRecord.readonly === true;
  const canRestart = !isReadonly && consoleRecord.status !== "idle" && consoleRecord.status !== "exited";
  const terminalBackground = consoleRecord.backgroundColor?.[theme] ?? terminalThemes[theme].background;

  const gathering = consoleRecord.gatherErrors !== false;
  const unread = useMemo(() => gathering ? unreadCards(cards, consoleRecord.readCardHashes) : [], [cards, consoleRecord.readCardHashes, gathering]);
  const filteredCards = unread.filter((card) => severityRank(card.category) >= severityRank(severityFilter));
  const cardCounts = unread.reduce(
    (acc, card) => {
      acc[card.category] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0, message: 0 }
  );

  function scrollToTerminal(behavior: ScrollBehavior = "smooth") {
    stageRef.current?.scrollIntoView({ block: "end", behavior });
  }

  useEffect(() => {
    if (!isReadonly && !canRestart) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      ignoreBracketedPasteMode: true,
      scrollback: 0,
      theme: { ...terminalThemes[theme], background: terminalBackground }
    });
    const fit = new FitAddon();
    fitRef.current = fit;
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
    if (nativeRef.current?.visible) terminal.resize(nativeRef.current.cols, nativeRef.current.rows);
    terminalRef.current = terminal;

    fetch(`/api/consoles/${consoleRecord.id}/output`)
      .then((response) => response.json())
      .then((data: { output: string }) => terminal.write(data.output, () => window.setTimeout(() => scrollToTerminal("auto"), 0)));

    const sendInput = (data: string) => {
      if (isReadonly || isWindowsTerminalReply(consoleRecord.shell, data)) return;
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
      if (nativeRef.current?.visible) {
        terminal.resize(nativeRef.current.cols, nativeRef.current.rows);
        return;
      }
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
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [consoleRecord.id, consoleRecord.lastStartedAt, theme, isReadonly, terminalBackground, canRestart]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (consoleRecord.nativeCli?.visible) {
      terminal.resize(consoleRecord.nativeCli.cols, consoleRecord.nativeCli.rows);
    } else {
      fitRef.current?.fit();
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", consoleId: consoleRecord.id, cols: terminal.cols, rows: terminal.rows }));
      }
    }
  }, [consoleRecord.id, consoleRecord.nativeCli?.visible, consoleRecord.nativeCli?.cols, consoleRecord.nativeCli?.rows]);

  useEffect(() => { setNativeError(""); setNativeBusy(false); }, [consoleRecord.id, consoleRecord.lastStartedAt]);

  async function toggleNative() {
    setNativeBusy(true);
    setNativeError("");
    try {
      const response = await fetch(`/api/consoles/${consoleRecord.id}/native`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: !consoleRecord.nativeCli?.visible })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Native CLI request failed");
      await onChanged();
    } catch (error) { setNativeError(error instanceof Error ? error.message : String(error)); }
    finally { setNativeBusy(false); }
  }

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
    const id = consoleRecord.id;
    fetch(`/api/consoles/${consoleRecord.id}`)
      .then((response) => response.json())
      .then((data: ConsoleSnapshot) => {
        if (consoleIdRef.current !== id) return;
        setCards(data.cards ?? []);
        if (loadedCardsConsole.current !== id) {
          loadedCardsConsole.current = id;
          window.requestAnimationFrame(() => scrollToTerminal("auto"));
        }
      });
  }, [consoleRecord.id, consoleRecord.errorCount, consoleRecord.unseenErrorCount, gathering]);

  async function changeGatherErrors(enabled: boolean | null) {
    setGatherBusy(true);
    setGatherError("");
    try {
      const response = await fetch(`/api/consoles/${consoleRecord.id}/gather-errors`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update error gathering");
      await onChanged();
    } catch (error) { setGatherError(error instanceof Error ? error.message : String(error)); }
    finally { setGatherBusy(false); }
  }

  async function markCardsRead() {
    const id = consoleRecord.id;
    await onMarkRead();
    const response = await fetch(`/api/consoles/${id}`);
    if (response.ok) {
      const snapshot = await response.json() as ConsoleSnapshot;
      if (consoleIdRef.current === id) setCards(snapshot.cards ?? []);
    }
  }

  function updateScrollState() {
    const node = scrollRef.current;
    const stage = stageRef.current;
    if (!node || !stage) return;
    setAtTerminal(stage.getBoundingClientRect().bottom <= node.getBoundingClientRect().bottom + 80);
  }

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener("scroll", updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(node);
    if (stageRef.current?.parentElement) observer.observe(stageRef.current.parentElement);
    updateScrollState();
    return () => { node.removeEventListener("scroll", updateScrollState); observer.disconnect(); };
  }, [scrollRef, consoleRecord.id, filteredCards.length, cardsCollapsed]);

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
      {toolbarHost ? createPortal(<div className="toolbar">
        <div className="cards-toolbar">
          <button className="cards-toggle" aria-expanded={!cardsCollapsed} onClick={() => setCardsCollapsed((value) => !value)}>
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
              <label className="gather-errors-control" title={consoleRecord.gatherErrorsOverride === undefined ? "Inherited from project" : "Session override"}>
                <input type="checkbox" role="switch" checked={gathering} disabled={gatherBusy} onChange={(event) => void changeGatherErrors(event.target.checked)} />
                Gather errors
              </label>
              {consoleRecord.gatherErrorsOverride !== undefined ? <button className="gather-errors-reset" title="Use project default" aria-label="Use project default for Gather errors" disabled={gatherBusy} onClick={() => void changeGatherErrors(null)}>&#8634;</button> : null}
              <button onClick={() => void markCardsRead()}>Mark read</button>
              <button onClick={() => post("signal", { signal: "ctrl+c" })}>Ctrl+C</button>
              <button onClick={() => post(canRestart ? "restart" : "start")}>{canRestart ? "Restart" : "Start"}</button>
              {consoleRecord.nativeCli && canRestart ? <button disabled={nativeBusy} onClick={() => void toggleNative()}>{consoleRecord.nativeCli.visible ? "Скрыть native cli" : "Показать native cli"}</button> : null}
              {consoleRecord.project === "Default" || canRestart ? <button onClick={onClose}>{consoleRecord.project === "Default" && !canRestart ? "Delete" : "Close"}</button> : null}
              {consoleRecord.projectPath || consoleRecord.project === "Default" ? <ConsoleActionsMenu key={consoleRecord.id} consoleRecord={consoleRecord} onEditConfig={onEditConfig} onDelete={consoleRecord.projectPath ? onDeleteConfig : onClose} /> : null}
            </div>
          ) : null}
        </div>
        {gatherError ? <div role="alert">{gatherError}</div> : null}
      </div>, toolbarHost) : null}
      {nativeError ? <div role="alert">{nativeError}</div> : null}
        {!cardsCollapsed ? <CardsPanel cards={filteredCards} /> : null}
        <div className="terminal-stage" ref={stageRef}>
          <div ref={hostRef} className="terminal-host" hidden={!isReadonly && !canRestart} />
          {!isReadonly && !canRestart ? <DisabledConsoleOverlay consoleRecord={consoleRecord} /> : null}
        </div>
        {debugMode ? <ErrorDebugPanel matches={cards.map((card) => ({ id: card.id, createdAt: card.createdAt, line: card.title, reason: `${card.kind} ${card.category}` }))} /> : null}
        {!atTerminal ? (
          <button className="scroll-terminal-button" onClick={() => scrollToTerminal()} title="Scroll to terminal" aria-label="Scroll to terminal">
            v
          </button>
        ) : null}
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
