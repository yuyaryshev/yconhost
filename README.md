# yconhost

yconhost is a local web UI/API for supervising host command processes through a ConPTY/pipe backend. It exposes a browser-based terminal view, HTTP API, WebSocket streaming, and a small HTTP MCP surface for automation.

## Main Features

- Start, list, restart, and stop individual consoles.
- Batch-start project consoles from `mywins.json` or `my_wins.json`.
- Stream live terminal output over WebSocket.
- Render interactive terminals in the browser with xterm.js.
- Send plain text input and special commands such as `Ctrl+C` and `Ctrl+Break`.
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
- `GET /api/projects`
- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `DELETE /api/consoles/:id`
- `POST /mcp`

## Current Limitations

- yconhost uses the ConPTY/pipe backend only. It does not expose or manage separate native Windows console windows.
- Re-attach to already running processes after yconhost restart is not supported in the simplified pipe-only model.
- Chrome MCP UI testing may fail when the shared Chrome DevTools MCP profile is already locked by another process.
