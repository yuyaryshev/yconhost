# yconhost

yconhost is a local web UI/API for supervising host command processes through a ConPTY/pipe backend. It exposes a browser-based terminal view, HTTP API, WebSocket streaming, and a small HTTP MCP surface for automation.

## Main Features

- Start, list, restart, and stop individual consoles.
- Rename consoles inline from the console detail header; console definitions are persisted and recreated after yconhost restart.
- Batch-start project consoles from `mywins.json` or `my_wins.json`.
- Keep a persisted recent-project list, prevent duplicate project opens, and run project-wide start/stop/restart/read/close actions.
- Stream live terminal output over WebSocket.
- Render interactive terminals in the browser with xterm.js.
- Start pty sessions with `xterm-256color`/truecolor environment hints for color-capable CLI tools.
- Send plain text input and special commands such as `Ctrl+C` and `Ctrl+Break`.
- Persist console output logs under `data/logs`.
- Rotate logs and keep bounded in-memory scrollback.
- Detect errors from plain text and ANSI-colored output.
- Inspect exact error-matched lines in debug mode and reset unread error counters from the UI.
- Disable ANSI error parsing per console.
- Expose HTTP endpoints and a minimal HTTP MCP endpoint.
- Run as a production pm2 process.
- Restart the HTTP/MCP server without stopping running consoles; a separate PM2 terminal host owns their processes, logs and xterm state.

## Commands

- `pnpm install` - install dependencies.
- `pnpm test` - run endpoint and output analyzer tests.
- `pnpm typecheck` - run TypeScript checks.
- `pnpm build` - build server and client.
- `pnpm start:terminal-host` - run the terminal host (normally managed by PM2).
- `pnpm start` - run the production HTTP server; requires a running terminal host using the same settings/dataDir.

Production: `pm2 start ecosystem.config.cjs`, then `pm2 save`. For a server-only
upgrade use `pm2 restart yconhost`, **not** `pm2 restart all` or a restart of
`yconhost-terminal-host`. See [restart operations](docs/server_restart_without_console_loss.md).

The fixed production address is **http://127.0.0.1:4011/**. The default server port,
local `settings.json5`, and `ecosystem.config.cjs` use port `4011`. PM2 pins the
absolute settings path; the server does not silently choose another port if this
one is occupied. Explicit port overrides are only needed for isolated tests.

## API

- `GET /api/health`
- `GET /api/projects`
- `GET /api/recent-projects`
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

## Current Limitations

- The default backend uses ConPTY pipes. The optional yopenconsole backend also supports showing/hiding the same running console in a native window; see [Native CLI](docs/native_cli.md).
- Existing broker-owned sessions reattach after an HTTP-server restart, including native CLI and TUI state. Restarting the terminal host itself or Windows still ends its sessions. Saved commands are never automatically started after reboot.
- Chrome MCP UI testing may fail when the shared Chrome DevTools MCP profile is already locked by another process.
