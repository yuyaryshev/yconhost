# yconhost

yconhost is a local web UI/API for supervising host consoles. It keeps the real host console as the source of truth and exposes a browser-based terminal view, HTTP API, WebSocket streaming, and a small HTTP MCP surface for automation.

## Main Features

- Start, list, restart, and stop individual consoles.
- Batch-start project consoles from `mywins.json` or `my_wins.json`.
- Stream live terminal output over WebSocket.
- Render interactive terminals in the browser with xterm.js.
- Send plain text input and special commands such as `Ctrl+C` and `Ctrl+Break`.
- Switch between `managed` mode and `manual` mode; web input is read-only in manual mode.
- Persist console output logs under `data/logs`.
- Rotate logs and keep bounded in-memory scrollback.
- Detect errors from plain text and ANSI-colored output.
- Disable ANSI error parsing per console.
- Expose HTTP endpoints and a minimal HTTP MCP endpoint.
- Run as a production pm2 process.

## Commands

- `pnpm install` - install dependencies.
- `pnpm test` - run endpoint and output analyzer tests.
- `pnpm typecheck` - run TypeScript checks.
- `pnpm build` - build server and client.
- `pnpm start` - run the production build.

The production pm2 config is in `ecosystem.config.cjs` and currently binds to `127.0.0.1:4010` because port `4000` is already used on this host.

## API

- `GET /api/health`
- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `POST /api/consoles/:id/mode`
- `POST /api/consoles/:id/vanilla`
- `DELETE /api/consoles/:id`
- `POST /mcp`

## Current Limitations

- Vanilla console show/hide is currently represented in yconhost state and mode switching. Direct OS-level show/hide of an existing console window still needs a Windows-specific adapter.
- Re-attach after yconhost restart currently restores metadata and persisted output; live process re-attachment to an already running console is still under implementation.
- Chrome MCP UI testing may fail when the shared Chrome DevTools MCP profile is already locked by another process.
