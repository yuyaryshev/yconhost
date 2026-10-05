# yconhost Reference Specification

Status: draft for approval. This document is a consolidated target specification extracted from the project history, current implemented behavior, and the deferred headless-xterm error-cards design.

## 1. Purpose

yconhost is a local single-user web application for supervising command-line processes on the host machine.

It provides:

- browser-based interactive terminal access;
- project-oriented process groups based on `mywins.json` / `my_wins.json`;
- persistent console definitions and output logs;
- HTTP API and minimal HTTP MCP API for automation;
- optional extracted message/error cards based on terminal-rendered state.

The application is intended for local development workflows where many consoles should be started, watched, restarted, stopped, and inspected from one browser UI.

Authentication and multi-user isolation are out of scope.

## 2. Historical Decisions

### 2.1 Removed Native Console Window Direction

The initial idea required real native Windows console windows (`conhost.exe`) to exist alongside the web terminal, with managed/manual modes and possible re-attach after yconhost restart.

This was investigated and rejected:

- safe vanilla-console plus pipe streaming/input was not found to be viable;
- `cmd_mitm_hack.exe` / conhost replacement experiments were considered too hacky and risky;
- global hooks or machine-wide dangerous approaches are explicitly out of scope;
- simulating a vanilla window is not useful because the vanilla window was only valuable if it preserved behavior that pipe mode could not.

Target architecture is therefore pipe-only.

### 2.2 Current Pipe-Only Baseline

yconhost manages processes through `node-pty` / ConPTY on Windows.

The web terminal is xterm.js in the browser. yconhost does not expose or manage separate native Windows console windows.

Re-attach to already running child processes after yconhost restart is not required. Instead, persisted console definitions are recreated after restart.

## 3. Current Implemented Features To Preserve

### 3.1 Console Lifecycle

The system supports:

- create one console;
- list consoles;
- select a console;
- restart a console;
- stop/close a console and its process tree;
- send text input;
- send special commands such as `Ctrl+C` and `Ctrl+Break`;
- read console output tail or full output;
- display PID in console details.

Process termination should affect the whole process tree, not only the root PID.

### 3.2 Console Creation UI

The sidebar header has three creation controls:

- `+`: immediately creates a default `cmd.exe` console in the current yconhost working directory.
- folder/open button: prompts only for a working directory.
  - If the directory contains `mywins.json` or `my_wins.json`, open it as a project.
  - Otherwise, create a `cmd.exe` console with that working directory.
- burger menu:
  - contains advanced `Create...`;
  - advanced create allows choosing `cmd.exe`, `powershell.exe`, or `Other...`;
  - manual executable path input is shown only for `Other...`;
  - advanced create supports command and working directory fields.

### 3.3 Console Details UI

The details pane shows:

- inline-editable console name in the details header;
- current working directory;
- PID;
- `Mark read`;
- `Ctrl+C`;
- `Restart`;
- `Close`;
- xterm.js terminal.

Console rename is done only in the details pane. The console list is only for switching between consoles and closing them.

Console name is persistent and survives yconhost restart.

### 3.4 Sidebar Console List

The sidebar groups consoles by project.

There is always a `Default` group.

Each console row shows:

- status indicator;
- console name;
- unread error badge;
- close button.

Clicking a console row selects it.

### 3.5 Project Support

Project opening:

- a project is a directory with `mywins.json` or `my_wins.json`;
- project config has `wins`;
- entries with `no_run` are skipped;
- each win creates one console;
- console `project` is the project directory basename;
- console `cwd` can be project root or a config-relative subdirectory;
- command can be `cmd` or `command`.

Duplicate project opening is blocked:

- opening the same project path again must not create another set of consoles;
- for migration safety, an already-open project with the same project name should also be treated as duplicate when path metadata is absent.

Project actions:

- close project;
- restart all consoles;
- stop all consoles;
- start all consoles;
- mark all as read.

Project actions are available from a burger menu next to the project header.

### 3.6 Recent Projects

The folder/open dialog includes a persisted recent-project list below `Working directory`.

Behavior:

- recent projects are stored in a file under the yconhost data directory;
- opening a project updates/touches the recent list;
- typing into `Working directory` filters recent projects by substring in project name or path;
- example: typing `book` should find `books_lib`;
- each recent project row has a burger menu with `Close`;
- `Close` removes the recent project entry and closes the project if it is currently open.

### 3.7 Persistence

Persisted data:

- console definitions;
- recent projects;
- output logs.

Console definitions are recreated after yconhost restart. This is not process re-attach.

Output logs are stored under `data/logs`.

Log requirements:

- max log size configurable;
- rotated log files configurable;
- bounded in-memory scrollback configurable.

### 3.8 Terminal Behavior

Browser terminal:

- xterm.js;
- live output over WebSocket;
- no polling-only live mode;
- input should pass through without destructive normalization;
- paste, unicode, arrows, home/end, page up/down, tab, and multiline input should work as xterm/node-pty normally support them.

PTY environment:

- terminal sessions should advertise color-capable terminal state;
- use `TERM=xterm-256color`;
- use truecolor/color env hints such as `COLORTERM=truecolor`, `FORCE_COLOR=1`, `CLICOLOR=1`, `CLICOLOR_FORCE=1`;
- remove `NO_COLOR` from child env unless explicitly revisited.

### 3.9 Error Tracking Baseline

Current simple server-side tracker:

- scans raw PTY chunks;
- detects plain text `error` / `errors`;
- excludes `no errors`;
- excludes `errors 0`;
- optionally detects red/burgundy ANSI output;
- can disable ANSI parser per console;
- increments unread error count;
- stores matched lines for debug mode.

`Mark read` resets unread counters.

This tracker is useful but not the desired long-term source of rich error/message cards.

### 3.10 Debug Mode

Global burger includes debug mode toggle.

Current debug mode shows matched raw-parser lines in console details.

This is a diagnostic feature and may be replaced by the headless-xterm cards architecture.

### 3.11 API

Required HTTP API:

- `GET /api/health`
- `GET /api/projects`
- `GET /api/recent-projects`
- `DELETE /api/recent-projects`
- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/name`
- `POST /api/consoles/:id/read`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `DELETE /api/consoles/:id`
- `POST /api/projects/:project/restart`
- `POST /api/projects/:project/stop`
- `POST /api/projects/:project/start`
- `POST /api/projects/:project/read`
- `DELETE /api/projects/:project`
- `POST /mcp`

Minimal HTTP MCP API:

- list consoles;
- read console output;
- write console input.

MCP `create_console` and `register_console` create temporary consoles by default. Pass `persistent: true` to keep a console slot. A temporary console is removed automatically after the configured idle TTL when it has no live terminal session and has had no direct access, input, or output during that TTL.

## 4. Target Architecture With Backend Headless Xterm

If rich message/error cards become a core feature, the target architecture should use backend headless xterm instead of custom ANSI parsing.

Use:

- `@xterm/xterm` in browser;
- `@xterm/headless` on backend;
- versions should be kept reasonably aligned.

Architecture:

```text
node-pty session
  -> raw log store
  -> browser xterm.js over WebSocket
  -> backend @xterm/headless mirror
       -> normal buffer scan
       -> alternate screen detection
       -> persistent/temporary cards
       -> unread counters
```

The backend headless terminal is the canonical source for extracted cards and eventually for unread message/error counters.

The browser xterm remains the interactive UI renderer.

## 5. Headless Mirror Requirements

Each managed console owns one backend terminal mirror.

On PTY output:

```ts
mirror.write(chunk);
logStore.append(chunk);
websocketBroadcast(chunk);
```

The mirror must expose enough state to scan:

- `buffer.normal`;
- `buffer.active`;
- `buffer.alternate`;
- `onWriteParsed`;
- `rows`;
- `cols`;
- `baseY`.

Resize:

- browser sends resize events through WebSocket;
- server resizes both PTY and headless mirror;
- if several clients watch one console at different sizes, use a canonical size, initially last active client size;
- fallback size: `120x40`.

The extractor must tolerate wrapping differences between browser xterm and backend mirror.

## 6. Extracted Cards

Cards are not only errors. They represent extracted meaningful terminal messages.

Suggested type:

```ts
type ExtractedCard = {
  id: string;
  kind: "persistent" | "temporary";
  category: "error" | "warning" | "info" | "message";
  title: string;
  message: string;
  rawText: string;
  hash: string;
  createdAt: number;
  bufferY?: number;
};
```

### 6.1 Persistent Cards

Persistent cards are extracted from finalized normal scrollback:

```ts
const buffer = mirror.buffer.normal;
const start = lastScannedFinalY;
const end = buffer.baseY;
```

Rules:

- scan only newly finalized lines;
- cards remain even if terminal later clears scrollback;
- deduplicate by hash;
- persist or keep in server memory depending on product decision.

### 6.2 Temporary Cards

Temporary cards are extracted from current visible normal screen:

```ts
const buffer = mirror.buffer.normal;
const start = buffer.baseY;
const end = buffer.baseY + mirror.rows;
```

Rules:

- if active buffer is alternate, clear temporary cards and skip extraction;
- rebuild temporary cards on every throttled scan;
- hide temporary cards already represented by persistent cards.

### 6.3 Extraction Rules

Extractor works on blocks, not only single lines.

Initial grouping:

- split rendered buffer text by `\n`;
- empty line closes current message;
- stack trace lines like `    at ...` attach to previous message;
- known continuation lines attach to previous message;
- classify block as `error`, `warning`, `info`, or `message`.

Deduplication:

```ts
hash = `${category}:${normalize(rawText)}`;
```

Normalization:

- trim;
- collapse repeated whitespace;
- optionally normalize timestamps and absolute paths later.

### 6.4 Cards UI

Cards panel:

- outside xterm;
- no overlay;
- collapsible;
- preferably above xterm and below toolbar;
- max height with own scroll;
- shows total counts and categories;
- should not make xterm unusable.

The current debug panel should be replaced or reworked into this panel.

### 6.5 Click To Scroll

This is optional phase 2.

Backend `bufferY` is only an approximate hint because browser xterm may wrap differently.

Reliable click-to-scroll requires client-side markers/decorations for lines observed by the browser, or terminal state serialization/restoration.

Consider `@xterm/addon-serialize` later if exact state restoration becomes important.

## 7. Data Model

### 7.1 Console Definition

Required fields:

- `id`;
- `name`;
- `project`;
- `projectPath?`;
- `cwd`;
- `command`;
- `shell`;
- `args`;
- `ansiParserEnabled` or replacement tracker config;
- created/updated timestamps.

### 7.2 Runtime Console State

Required fields:

- console definition;
- PID;
- status: `starting`, `running`, `ready`, `exited`;
- exit code;
- PTY session;
- backend headless mirror;
- tail buffer;
- persistent cards;
- temporary cards;
- unread counts.

### 7.3 Project

Project identity should prefer normalized absolute `projectPath`.

Project name is display name and migration fallback, not ideal stable identity.

## 8. Configuration

Settings should support:

- host;
- port;
- data directory;
- default shell;
- log max bytes;
- log rotation count;
- scrollback bytes;
- tracker/extractor throttle;
- backend mirror default cols/rows;
- backend mirror scrollback size.

## 9. Testing Requirements

Backend:

- endpoint tests;
- console lifecycle tests;
- project duplicate-open tests;
- recent project persistence tests;
- project group action tests;
- headless mirror extraction tests;
- card grouping/dedup tests;
- resize handling tests.

Frontend:

- Chrome MCP smoke tests;
- creation controls;
- recent project filtering;
- project burger actions;
- console details rename;
- close buttons;
- mark read;
- cards panel not overlaying xterm.

Acceptance scenario:

- use `D:\b\Mine\GIT_Work\books_lib`;
- do not modify that project;
- verify duplicate open protection;
- verify project actions;
- verify UI remains usable.

## 10. Non-Goals

- native Windows console window management;
- vanilla/manual mode;
- conhost replacement;
- global hooks;
- multi-user auth;
- remote-host security model;
- guaranteed re-attach to child processes after yconhost restart.

## 11. Rewrite Assessment

The current codebase is a useful prototype and already implements many product features, but the headless-xterm card architecture changes the center of gravity:

- output tracking moves from raw chunk regexes to rendered terminal buffer state;
- resize becomes a first-class server concern;
- unread counters should eventually derive from extracted cards;
- debug/error UI should be redesigned around cards, not patched onto current debug mode.

This is not a tiny refactor. It affects runtime console ownership, WebSocket protocol, data model, tracker implementation, UI layout, and tests.

Recommended decision:

- If the goal is only to keep improving process/project controls, continue with small incremental changes.
- If rich cards based on terminal-rendered state are a core feature, a rewrite from this reference spec is justified.

Preferred rewrite approach:

1. Freeze this document as approved product spec.
2. Keep the current repo as behavioral reference and regression oracle.
3. Create a new implementation branch or new clean project directory.
4. Build the backend runtime around `node-pty` plus `@xterm/headless` from day one.
5. Add tests per feature before rebuilding the full UI.
6. Port only the accepted features listed in this document.

Do not carry forward native vanilla-console code or conhost experiments.
