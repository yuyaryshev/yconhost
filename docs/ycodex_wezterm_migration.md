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

2. Resolved 2026-10-19: sync Codex contexts automatically at every service startup. Import remains idempotent and creates idle slots only; it never starts Codex processes.

## Launch and Navigation Update, 2026-10-19

- New Windows consoles refresh machine/user environment variables from the registry (cached for ten seconds), merging the current PATH with inherited tool paths. This avoids depending on the age of PM2's environment. WezTerm explicitly adds ycodex/bin in its launcher, which explained why the same command previously failed in yconsole.
- Stopped consoles hide and dispose the browser terminal; the displayed command accepts mouse selection and copying.
- Projects with more than ten consoles are automatically marked isLarge. Their UI shows search plus the nine most recently started slots. Search covers all names, commands and working directories, including never-started slots. Show all lasts until the project is collapsed. Console lastStartedAt is persisted and is not changed by import or viewing.
- When more than three projects exist, projects initially appear collapsed.
- Project search and Show all share background, text and border theme colors with the Open folder dialog input in both dark and light themes. Browser computed-style checks confirmed all three colors match in each theme; production build passed.
- Their borders are flat one-pixel solid lines; native beveled input/button appearance is disabled.
- Legacy temp_* slots are removed from persisted console registrations during this deployment, across all projects. This cleanup does not change project mywins.json files.
- Codex launch verification exposed browser terminal device/color/focus reports being injected into the Windows command input. These generated reports are now suppressed for Windows native shells, while typed text, paste and navigation keys continue to pass through. Browser terminal dimensions are reapplied when lastStartedAt changes so Restart retains a correctly framed TUI.

### Verification Results

- Removed 194 legacy temp_* registrations: 186 from odbp_bundle and eight from odbp. The pre-cleanup JSON backup remains under the ignored data directory.
- Service startup automatically imported 71 Codex slots without launching any processes. Repeated import did not duplicate slots or start them.
- A console spawned by the PM2 service resolved ycodex.cmd and reported codex-cli 0.159.0+ycodex.c3403eed. An actual saved odbp_requirements session was launched and resumed through the browser.
- Browser checks covered initial project collapse, a 13-slot fixture showing nine recent launches, search matching an unstarted slot, Show all, and reset on collapse. The fixture project was removed after verification.
- Verified stopped-command copying through the system clipboard with no xterm instance under the overlay. Captured desktop/mobile screenshots under output/playwright; browser console reported no errors.
- Build and typecheck passed. Backend, selection and Windows PTY regressions passed; terminal-input tests cover report suppression and ordinary keyboard/paste preservation.

## Claude Contexts, 2026-10-28

- The same importer now accepts `claude` alongside `codex` and `ycodex`; all belong to `codexes`. Previously Claude sections were silently skipped, unlike WezTerm.
- Detection uses the executable in the code block, not the heading: a section such as `khb_process` can therefore be a Claude slot too.
- Each section uses its first agent command. Claude arguments (including `--resume`), working directory and color are preserved; Codex-specific executable/flag normalization never modifies Claude commands.
- Existing HTTP and MCP import names remain unchanged. Startup sync and explicit imports create persistent idle slots, without starting agents. Reimport updates slots by project/name without duplicating them or restarting running consoles.
- Large-project navigation still applies: search finds never-started slots; Show all reveals the complete list.

### Verification and Live Availability

- All 42 tests passed, including mixed Codex/Claude HTTP and MCP imports, stable IDs on reimport, and no implicit process launches. Production build passed.
- The live service was not restarted: its existing register_console MCP method registered the five missing Claude slots using the updated parser output and the same deterministic IDs as normal import. Commands, directories, colors and persistent idle state were checked through the API.
- Added khbuild_tests_claude, khb_agent_claude, khb_microservices_claude, khb_process and yopenconsole_claude. Repeating registration added nothing; existing running console PIDs and launch timestamps were unchanged.
- The compiled importer is ready for the next normal service restart. Until that restart, the older running import handler still skips new Claude sections, but the five registered slots are already persisted and available.
- The coordinated Gather errors deployment later on 2026-10-28 restarted the live service and activated the updated importer. Startup sync now includes Claude automatically; all 82 current codexes slots remained idle with card gathering disabled by default.
