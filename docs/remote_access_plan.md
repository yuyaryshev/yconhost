# yconsole remote access plan

## Goal

Expose the yconsole/yconhost UI and MCP endpoint on `https://ycons.yydev.mywire.org` while keeping all console processes running locally on `yuri-desktop`.

Only authenticated access for `yuyaryshev@gmail.com` should be allowed. The existing Keycloak deployment on `yydev.mywire.org` should be reused.

## Target Topology

```text
Browser / mobile web app
  -> https://ycons.yydev.mywire.org
  -> yydev nginx TLS vhost
  -> Keycloak/OIDC gate, preferably oauth2-proxy or the existing yydev auth pattern
  -> yydev localhost tunnel port
  -> SSH reverse tunnel from yuri-desktop
  -> 127.0.0.1:4011 yconsole on yuri-desktop
```

The yconsole service should continue to bind to `127.0.0.1` on the local Windows machine. Do not bind it directly to a public interface.

## Reverse Tunnel

Create a PM2-managed tunnel process on `yuri-desktop`, conceptually:

```powershell
ssh -N -T -F NUL `
  -o BatchMode=yes `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=3 `
  -o StrictHostKeyChecking=accept-new `
  -R 127.0.0.1:14011:127.0.0.1:4011 `
  root@yydev.mywire.org
```

The exact key path and PM2 app name should follow the existing tunnel conventions on this machine.

## yydev Proxy

Before changing yydev, inspect the existing `alfa.yydev.mywire.org` setup and mirror its pattern:

- certificate issuance/renewal mechanism;
- nginx vhost layout;
- Keycloak/OIDC integration;
- WebSocket proxy headers.

The yconsole vhost must proxy both HTTP and WebSocket traffic:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

## Android

Initial Android support should be mobile web/PWA over the same `https://ycons.yydev.mywire.org` endpoint. A native wrapper can be added later only if the mobile browser experience is not enough.

## Safety

- Do not restart the live local yconsole service during proxy work unless explicitly approved.
- Do not modify existing yydev vhosts until the current nginx and certificate configuration has been backed up or committed.
- Validate WebSocket terminal input/output through the external domain before considering the remote deployment complete.
