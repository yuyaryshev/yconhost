# ycodex WezTerm Migration

Status: planning / partially implemented; product decisions updated on 2026-10-05.
Created: 2026-10-05.

## Source Request

The user currently opens Codex through `D:\ProgsReady\WezTerm\yy_wezterm.cmd`.

In this setup:

- `ycodex` is the user's fork/wrapper of Codex.
- `yy_wezterm.cmd` prepends `D:\ProgsReady\ycodex\bin` to `PATH`, clears `YCODEX_HOME`, and starts WezTerm with `yy_wezterm.lua`.
- WezTerm provides:
  - separate tabs for different ycodex instances;
  - distinct tab/background colors per instance;
  - built-in ycodex launch presets;
  - saved Codex launch contexts loaded from a Markdown file.

The target is to move this workflow into yconsole/yconhost:

- yconsole should have a project named `codexes`.
- This project should contain all ycodex contexts as console entries.
- Entries should be present immediately as not-yet-running tabs/slots.
- Import must not start ycodex processes.
- Selecting/opening an imported slot must not start a ycodex process.
- A ycodex process starts only when the user or an LLM agent explicitly runs Start/start_console for that slot.
- Label colors and terminal backgrounds should match the WezTerm colors.
- Unlike WezTerm, yconsole should import all saved contexts from the source file, not only the startup presets.
- Existing partial implementation must be reused; do not create duplicate importers, duplicate API methods, or parallel data models.

The user asked to preserve this request in project docs because prior chat context was lost.

## Source Files

WezTerm entrypoint:

- `D:\ProgsReady\WezTerm\yy_wezterm.cmd`

WezTerm config:

- `D:\ProgsReady\WezTerm\yy_wezterm.lua`
- `D:\ProgsReady\WezTerm\yy_wezterm_codexes.lua`

Markdown contexts:

- `D:\b\InfoVault\Codex contexts.md`

Current WezTerm built-in presets:

| id | name | background |
| --- | --- | --- |
| `odbp` | `odbp` | `#000032` |
| `smartsol` | `smartsol` | `#320032` |
| `ytimecontrol` | `ytimecontrol` | `#003232` |
| `alfa` | `alfa` | `#320000` |
| `sparxexec` | `sparxexec` | `#323200` |

Current WezTerm startup presets:

- `odbp`
- `smartsol`
- `ytimecontrol`
- `alfa`
- `sparxexec`

The Markdown contexts file currently contains 76 top-level headings. Not every heading is necessarily importable: the importer should only create a yconsole entry when a context has a color and a code block containing a Codex/ycodex command.

## Existing yconsole Implementation

The previous Codex already implemented part of this feature.

Relevant files:

- `src/server/codexContexts.ts`
- `src/server/consoleManager.ts`
- `src/server/api.ts`
- `src/server/settings.ts`
- `src/server/types.ts`
- `src/client/main.tsx`
- `tests/api.test.ts`
- `settings.example.json5`

Existing behavior:

- `codexContexts` settings exist:
  - `projectName`
  - `contextsPath`
  - `weztermPresetsPath`
- default `contextsPath` is `D:\b\InfoVault\Codex contexts.md`;
- default `weztermPresetsPath` is `D:\ProgsReady\WezTerm\yy_wezterm_codexes.lua`;
- HTTP endpoint exists:
  - `POST /api/codex-contexts/import`
- MCP tool exists:
  - `import_codex_contexts`
- UI global burger contains:
  - `Import Codex contexts`
- importer loads:
  - WezTerm built-in presets from `yy_wezterm_codexes.lua`;
  - Markdown contexts from `Codex contexts.md`;
- importer deduplicates by command;
- imported slots are currently created as:
  - `status: "idle"`
  - `noRun: true`
  - `background: #RRGGBB`
  - `start: false`
- UI uses `backgroundColor` / `background` for console-row color and selected terminal background.
- `TerminalPane` previously auto-started imported slots when opened via `autoStartOnOpen`. This behavior is now rejected by product decision and should remain removed.

Important: this is not committed in git. It is part of the current dirty worktree. `git log --since="7 days ago"` returned no commits. `HEAD` is still the old `last-node-pty` commit, while many implementation files are modified/untracked.

## Current Gaps / Mismatches

1. Project name.
   Accepted default project name is `codexes`.

2. Startup semantics are now decided.
   Import creates idle slots only. Opening/selecting a slot must not start a process. A ycodex process starts only on explicit Start/start_console.

3. PATH / environment parity with `yy_wezterm.cmd`.
   WezTerm adds `D:\ProgsReady\ycodex\bin` to `PATH` and clears `YCODEX_HOME` before launching. The current yconsole importer rewrites commands to `ycodex`, but server-spawned processes must also reliably find `ycodex`.
   Decision: add `D:\ProgsReady\ycodex\bin` to system-wide Windows `Path` rather than injecting a per-console command prefix.

4. `CODEX_HOME` / `YCODEX_HOME` handling.
   Accepted behavior is WezTerm parity: Markdown context prefix lines assigning `CODEX_HOME` or `YCODEX_HOME` are skipped. The importer does not convert `CODEX_HOME` to `YCODEX_HOME`.

5. Markdown parser robustness.
   Some contexts contain prose, old commands, multiple `set CODEX_HOME` lines, multiple `codex resume` lines, malformed command order, or no command. The current importer takes the first codex-like command line in the code block. This may create entries that differ from how the user expects to launch a context.

6. UI discoverability.
   Import is in the global burger. The requested mental model is a dedicated `codexes` project. The project may need a dedicated refresh/import action, visual grouping, or pinned/collapsed behavior.

7. No explicit "sync from source file" semantics.
   Current import upserts by project+name and reorders imported entries. Need to decide whether removed Markdown contexts should remove old yconsole entries, keep stale entries, or mark them hidden.

8. Tests/settings must assert the accepted project name `codexes`.

## Proposed Implementation Plan

### Phase 1: Stabilize Current Partial Implementation

1. Change default codex contexts project name to `codexes` in:
   - `src/server/settings.ts`
   - `settings.example.json5`
   - tests.

2. Keep one importer:
   - `loadCodexContextPresets(...)` in `src/server/codexContexts.ts`.
   - Do not add another parser or endpoint.

3. Preserve existing HTTP and MCP contracts:
   - `POST /api/codex-contexts/import`
   - MCP `import_codex_contexts`

4. Make launch environment explicit for imported ycodex consoles:
   - either prepend `D:\ProgsReady\ycodex\bin` to `PATH` in child process env for these consoles;
   - or store `shell: "cmd.exe"` and command prefix that sets PATH before running ycodex.

5. Implement and document startup behavior.
   Accepted behavior:
   - import creates all slots idle;
   - opening/selecting an imported slot does not start it;
   - only explicit Start/start_console starts ycodex;
   - service restart never starts ycodex instances automatically.

6. Add tests for:
   - default project is `codexes`;
   - built-in presets are imported in WezTerm order;
   - Markdown contexts are imported after built-ins;
   - colors are preserved;
   - imported slots are idle and do not spawn processes during import;
   - selecting/opening a slot does not spawn a process;
   - start endpoint starts a selected imported slot.

### Phase 2: Improve Context Parsing Fidelity

1. Compare TypeScript parser to `yy_wezterm_codexes.lua` line-by-line.
2. Keep TypeScript behavior aligned with WezTerm unless there is an explicit product decision to diverge.
3. Add fixtures copied from real context edge cases:
   - multiple `set CODEX_HOME` lines;
   - contexts with no codex command;
   - contexts where `codex resume` comes before `cd`;
   - contexts with old/alternate commands after separators;
   - contexts using `ycodex` already.
4. Ensure generated command uses ycodex and includes `--bypass-safety-y`.

### Phase 3: UI Product Polish

1. Make `codexes` project easy to find:
   - possibly pinned near top;
   - possibly auto-expanded after import.

2. Ensure color parity:
   - row stripe/background uses preset color;
   - selected terminal background uses preset color;
   - light theme uses an acceptable derived tint or exact color by product decision.

3. Add a project-level action:
   - "Sync Codex contexts"
   - should call the existing import endpoint.

4. Avoid duplicate entries:
   - imported IDs should remain stable.
   - current stable ID is based on project + name via `managedConsoleId(...)`.

### Phase 4: Verification Without Disturbing Live Service

Per `AGENTS.md`, do not restart/redeploy live local yconhost when not required.

Verification should use:

- alternate port;
- alternate data directory;
- fake terminal tests for backend behavior;
- browser test against alternate port only if UI verification is required.

Suggested local verification:

```powershell
pnpm run typecheck
pnpm test
```

For manual HTTP checks, start a temporary instance on a different port and data dir instead of touching PM2 `yconhost`.

## Open Questions

1. When a context disappears from the Markdown file, should import remove it from `codexes`, leave it unchanged, or mark it stale?

2. Should live yconsole automatically sync `codexes` at service startup, or should sync be manual only via UI/MCP? Current implementation is manual only.
