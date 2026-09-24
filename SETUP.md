# Deployment and setup guide

This guide covers a production self-hosted installation. Keep the bot backend private behind the Compose network; expose only the Next.js service through your HTTPS reverse proxy.

## 1. Requirements

### Docker deployment

- A Linux server with Docker Engine 25 or later and the Docker Compose v2 plugin.
- A public DNS name and HTTPS reverse proxy (Caddy or Nginx).
- One running backend replica. Verification tickets are short-lived and stored in memory.

### Bare-metal development or deployment

- Node.js 24 LTS and npm bundled with Node.
- `backend/` uses TypeScript, grammY, Koa and Fluent. It polls Telegram and exposes the internal verification API on port 3000 by default.
- `frontend/` uses Next.js App Router, React, TypeScript, Tailwind CSS v4 and shadcn/ui-style components. It listens on port 3000 by default; choose another host port if both services share a machine.
- No external database or migration step is required. Tickets are held in process memory and are lost on backend restart.

## 2. Create a Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`.
2. Choose a display name and a unique username. Save the API token privately.
3. Put the token in `TELEGRAM_BOT_TOKEN` and the bot username, without `@`, in `TELEGRAM_BOT_USERNAME` and `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
4. Keep the default privacy setting unless your group has a separate reason to change it. The bot does not need to read ordinary group messages.
5. The bot must be an administrator with permission to invite users/manage join requests. The required Telegram permission is `can_invite_users`.

## 3. Configure the Telegram group

1. In the group settings, enable approval of new members / join requests.
2. Add the bot as an administrator and grant permission to invite users or approve join requests.
3. Submit a join request from a separate test account. Telegram sends the bot a `chat_join_request` update.
4. The bot sends the applicant a private message and verification buttons. Telegram provides a temporary `user_chat_id` for this message; the bot uses it while that private contact window is valid.

If the bot cannot receive join requests, check that it is an administrator and that join-request approval is enabled. The user must start the bot or request to join in a way that makes the temporary private chat available.

## 4. Environment variables

Copy `.env.example` to `.env` in the repository root for Compose. For bare-metal development, copy the root example to `backend/.env` and set `PORT=3001`; copy `frontend/.env.example` to `frontend/.env.local`. Do not commit those files.

| Variable | Required | Used by | Meaning |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Backend | Secret token from BotFather. Anyone with it can control the bot. |
| `TELEGRAM_BOT_USERNAME` | Yes | Backend | Username belonging to the token, without `@`; checked against Telegram at startup. |
| `PUBLIC_BASE_URL` | Yes | Both | Exact public HTTPS origin, such as `https://verify.example.com`; no path, credentials, query or fragment. In local development only, backend allows `http://localhost`. |
| `VERIFICATION_SECRET` | Yes | Backend | At least 32 bytes of cryptographically random material used to sign tickets. Generate with `openssl rand -base64 48`. Rotating it invalidates open verification links. |
| `VERIFICATION_TTL` | No | Backend | Ticket lifetime in seconds, from 60 to 900; defaults to `180`. |
| `TURNSTILE_SECRET_KEY` | Yes | Backend | Private Cloudflare Turnstile server-side secret. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Yes | Frontend | Public Turnstile widget site key. It is embedded in the browser bundle; it is not a secret. |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Yes | Frontend | Public Telegram bot username, without `@`; also passed as a Docker build argument. |
| `FRONTEND_PORT` | No | Compose | Host port for the web app; defaults to `3000`. |
| `FRONTEND_BIND_ADDRESS` | No | Compose | Host interface for the web app; defaults to `127.0.0.1` for a local reverse proxy. |
| `PORT` | No | Bare metal | Service listen port; defaults to `3000`. Set backend to `3001` when the frontend also uses `3000`. Compose sets both container ports internally. |
| `NODE_ENV` | No | Both | Set to `production` in deployed containers. |
| `BACKEND_BASE_URL` | Yes | Frontend | Internal backend origin; Compose overrides it to `http://backend:3000`. For bare metal, use the backend address, such as `http://127.0.0.1:3001`. Do not point it at a user-controlled host. |

The examples use obvious placeholders and cannot run until replaced. For local frontend development, its example uses `http://localhost:3000` and a backend at `http://127.0.0.1:3001`; production requires HTTPS. The project does not use `DATABASE_URL`. Do not put bot tokens, Turnstile secrets or the verification secret in `NEXT_PUBLIC_*` variables, browser URLs, issue reports or screenshots.

When upgrading an existing tg-watchdog deployment, keep its old `TGWD_SECRET` value as the new `VERIFICATION_SECRET` so any still-live legacy links can validate. The backend temporarily accepts legacy names such as `TGWD_TOKEN`, `TGWD_FRONTEND_DOMAIN`, `TGWD_CFTS_API_KEY` and `TGWD_PORT` with a deprecation log, but new deployments should use the names in this table. In-memory pending state itself does not survive a restart.

## 5. Domain and HTTPS

Create an A/AAAA record for `verify.example.com` pointing to the server, and configure the reverse proxy to forward HTTPS traffic to the frontend's host port (3000 by default). Then set `PUBLIC_BASE_URL=https://verify.example.com` exactly. Configure the same host name in the Cloudflare Turnstile widget's allowed hostnames.

HTTPS is required in production because Telegram Web Apps and identity data rely on a secure origin. The app builds Telegram links from the configured origin; it does not trust the inbound `Host` or forwarded-host header to construct those links. Configure TLS termination at the proxy and pass the request through to Next.js.

## 6. Docker deployment

From the repository root:

```bash
cp .env.example .env
# Edit .env and replace every placeholder with the matching real value.
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f backend frontend
```

The backend is available to the frontend only on the private Compose network. The frontend publishes `${FRONTEND_PORT:-3000}`. Both images use multi-stage builds and run as the unprivileged `node` user. Health checks are available at `/health` on each service. Compose waits for the backend health check before starting the frontend.

## 7. Caddy example

If Caddy runs on the host, add this site to its Caddyfile and reload Caddy. Compose publishes the frontend on loopback by default so only a local proxy can reach it. If the proxy runs on another host/container, bind the published port to an interface reachable by that proxy and firewall it appropriately.

```caddyfile
verify.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews the HTTPS certificate when DNS and inbound ports 80/443 are set up correctly.

## 8. Nginx example

This minimal server block assumes certificates are already installed and Docker publishes the frontend on loopback.

```nginx
server {
    listen 80;
    server_name verify.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name verify.example.com;

    ssl_certificate     /etc/letsencrypt/live/verify.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/verify.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Do not expose backend port 3000 on the host. Next.js uses `PUBLIC_BASE_URL` as the origin allow-list and uses a fixed internal backend address, so a forwarded Host header cannot redirect the API proxy to another service.

## 9. First startup

There are no database migrations or one-time database initialization. Compose starts the backend, then waits for `/health`; the frontend starts when the backend is healthy. Backend startup validates required configuration, connects to Telegram to validate the token/username, loads translations and begins long polling. Check:

```bash
docker compose ps
curl -fsS https://verify.example.com/health
docker compose logs --tail=100 backend
```

The health response reports process availability, not Telegram credential validity after startup.

## 10. Verification test

1. Use a test group with join requests enabled and add the bot as an administrator with invite-user permission.
2. From a separate Telegram account, request to join the group.
3. Confirm the bot sends a private message with an in-app verification button and a browser fallback.
4. Open the link in Telegram or a mobile browser and complete the Turnstile challenge.
5. Confirm the request becomes approved and the bot removes the verification message.
6. Open the same link again and confirm it reports that the request was already verified; the join action must not run twice.

The repository's tests mock Telegram and Turnstile calls. They do not simulate a live Telegram account or replace this manual test.

## 11. Updating

```bash
git pull
docker compose build
docker compose up -d
docker compose logs -f
```

This release has no persistent schema migrations. Restarting the backend clears pending verification tickets and invalidates links already sent; advise users to submit a new join request if needed. Check the release notes before updates that change configuration variables.

## 12. Backup

There is no database to back up. Store an encrypted backup of `.env` and your proxy/TLS configuration in a private location. Protect the Telegram token, Turnstile secret and verification secret. Backing up the verification secret alone does not preserve active tickets across a restart because the ticket state is held in memory.

## 13. Troubleshooting

| Symptom | Checks |
| --- | --- |
| Bot does not receive a join request | Confirm join requests are enabled, bot is an administrator, and the Telegram token is the one for this bot. Inspect backend logs without sharing credentials. |
| Bot cannot approve users | Grant invite-user / manage-join-requests permission (`can_invite_users`) and verify the bot is still an administrator. |
| No private verification message | Check backend logs for `verification_request_delivery_failed`; the temporary private chat can only be used for a limited time. Ask the user to retry their request. |
| Verification URL does not open | Check DNS, `PUBLIC_BASE_URL`, proxy upstream and `/health`; ensure the proxy serves the same public origin configured in `.env`. |
| HTTPS or Telegram Web App error | Use a valid public HTTPS certificate. HTTP localhost is only suitable for local development, not Telegram production use. |
| Invalid token | A restart, secret rotation, malformed query, altered URL or replay can invalidate a ticket. Ask the user to start a fresh join request. |
| Expired verification | Tickets expire after `VERIFICATION_TTL` seconds. Retry with a new request; do not extend the URL lifetime in the browser. |
| API connection failed | Check that backend is healthy and frontend uses `http://backend:3000` on the Compose network. Never expose or configure a user-supplied backend URL. |
| Telegram API error | Check Telegram reachability, bot admin rights, API service status and sanitized backend logs. Retryable transport or server failures are retried a bounded number of times. |
| Reverse proxy error | Verify TLS, the upstream host port, and forwarded protocol settings. The backend should remain private; the proxy points only to frontend. |
| Database unavailable | This app has no database. Remove stale database environment settings from external wrappers and check backend memory/service health instead. |

Avoid posting full verification URLs, bot tokens, Telegram login payloads or CAPTCHA secrets in logs or support requests.
