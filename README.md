# yconhost

yconhost is a local web UI/API for supervising host consoles.

## Commands

- `pnpm install` - install dependencies
- `pnpm test` - run endpoint and output analyzer tests
- `pnpm build` - build server and client
- `pnpm start` - run the production build

The production pm2 config is in `ecosystem.config.cjs` and currently binds to `127.0.0.1:4010` because port `4000` is already used on this host.

## API

- `GET /api/consoles`
- `POST /api/consoles`
- `POST /api/batch`
- `GET /api/consoles/:id/output`
- `POST /api/consoles/:id/input`
- `POST /api/consoles/:id/signal`
- `POST /api/consoles/:id/restart`
- `DELETE /api/consoles/:id`
- `POST /mcp`
