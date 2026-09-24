# Deployment and setup guide

This guide covers both a production self-hosted installation and a pure-static Cloudflare Pages frontend. The Pages site contains only static files and calls the independently hosted backend API over HTTPS. A Docker-only deployment can continue to use the Next.js server-side API proxy.

## 1. Requirements

### Docker deployment

- A Linux server with Docker Engine 25 or later and the Docker Compose v2 plugin.
- A public DNS name and HTTPS reverse proxy (Caddy or Nginx).
- One running backend replica. Verification tickets are short-lived and stored in memory.

### Bare-metal development or deployment

- Node.js 24 LTS and npm bundled with Node.
- `backend/` uses TypeScript, grammY, Koa and Fluent. It polls Telegram and exposes the internal verification API on port 3000 by default.
- `frontend/` uses Next.js App Router, React, TypeScript, Tailwind CSS v4 and shadcn/ui-style components. It listens on port 3000 by default; choose another host port if both services share a machine.
- For Cloudflare Pages, the frontend is exported to `frontend/out` and runs without a Next.js server or Pages Functions.
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
| `NEXT_PUBLIC_BACKEND_BASE_URL` | Static Pages only | Frontend build | Public HTTPS origin of the backend API, such as `https://api.example.com`; embedded in browser JavaScript, so it must contain no credentials or secret. Required by the static build. Leave empty for the Docker server build. |
| `CORS_ALLOWED_ORIGINS` | No | Backend | Optional comma-separated exact HTTPS origins, for example a Cloudflare Pages preview URL. The configured `PUBLIC_BASE_URL` origin is always allowed. Wildcards are not accepted. |
| `BACKEND_BIND_ADDRESS` | No | Compose | Host interface for the backend published port; defaults to loopback `127.0.0.1`, intended for a reverse proxy on the same server. |
| `BACKEND_HOST_PORT` | No | Compose | Host port forwarded to the backend's port 3000; defaults to `3001`. |

The examples use obvious placeholders and cannot run until replaced. For local frontend development, its example uses `http://localhost:3000` and a backend at `http://127.0.0.1:3001`; production requires HTTPS. The project does not use `DATABASE_URL`. Do not put bot tokens, Turnstile secrets or the verification secret in `NEXT_PUBLIC_*` variables, browser URLs, issue reports or screenshots.

When upgrading an existing tg-watchdog deployment, keep its old `TGWD_SECRET` value as the new `VERIFICATION_SECRET` so any still-live legacy links can validate. The backend temporarily accepts legacy names such as `TGWD_TOKEN`, `TGWD_FRONTEND_DOMAIN`, `TGWD_CFTS_API_KEY` and `TGWD_PORT` with a deprecation log, but new deployments should use the names in this table. In-memory pending state itself does not survive a restart.

## 5. Domain and HTTPS

Create an A/AAAA record for `verify.example.com` pointing to the frontend host and, when using static Pages, a separate API name such as `api.example.com` pointing to the backend host. Configure the reverse proxy to forward HTTPS traffic to the correct service. Set `PUBLIC_BASE_URL=https://verify.example.com` exactly. Configure the frontend host name in the Cloudflare Turnstile widget's allowed hostnames.

HTTPS is required in production because Telegram Web Apps and identity data rely on a secure origin. The bot builds Telegram links from the configured `PUBLIC_BASE_URL`; it does not trust inbound `Host` or forwarded-host headers to construct those links. Configure TLS for both the verification website and, in static Pages mode, the backend API host.

### Cloudflare Pages: static frontend, no Functions

In Cloudflare Pages, set the repository root directory to `frontend` (keep this field populated). Use framework preset `None`, build command `npm run build`, and build output directory `out`. Set the build-time variables:

```text
NEXT_PUBLIC_BACKEND_BASE_URL=https://api.example.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<public Turnstile site key>
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=<bot username without @>
NODE_VERSION=24
```

The static build puts HTML, JavaScript, CSS and `_headers` in `frontend/out`. It omits the Next.js server API route; no `functions/` directory or Pages Function is produced. Pages does not run the Telegram bot. Run the backend separately and publish its API through HTTPS. Set backend `PUBLIC_BASE_URL` to the Pages custom domain (`https://verify.example.com`), then set `CORS_ALLOWED_ORIGINS` to exact preview origins if Pages previews also need to make browser API requests. The canonical `PUBLIC_BASE_URL` origin is allowed automatically. Do not use wildcard CORS. Keep the Pages framework preset at `None`: the project build script prepares the static export and `npx next build` by itself is not the configured Pages build command.

In this mode, browsers call the backend directly, so the API hostname must have a valid HTTPS certificate and be reachable from users' browsers. `NEXT_PUBLIC_BACKEND_BASE_URL` is public and is compiled into the static assets. Keep bot credentials, Turnstile secret and verification secret on the backend only. Requests use JSON POST without cookies; the backend's exact-origin CORS policy allows only the configured website origins.

For a local Pages build:

```bash
cd frontend
npm ci
NEXT_PUBLIC_BACKEND_BASE_URL=https://api.example.com \
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key \
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=YourVerificationBot \
npm run build
```

On Windows PowerShell, set those values with `$env:NEXT_PUBLIC_BACKEND_BASE_URL`, `$env:NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and `$env:NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` before running `npm run build`.

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

The backend is published on `${BACKEND_BIND_ADDRESS:-127.0.0.1}:${BACKEND_HOST_PORT:-3001}` so a local proxy can expose an HTTPS API host when using static Pages; loopback is the default. The frontend publishes `${FRONTEND_PORT:-3000}`. Both images use multi-stage builds and run as the unprivileged `node` user. Health checks are available at `/health` on each service. Compose waits for the backend health check before starting the frontend.

## 7. Caddy example

If Caddy runs on the host, add the relevant site blocks to its Caddyfile and reload it. The verification-site block is for Docker-hosted frontend; the API block is for a static Pages frontend. Compose publishes both services on loopback by default so only a local proxy can reach them. If the proxy runs on another host/container, bind the published ports to an interface reachable by that proxy and firewall them appropriately.

```caddyfile
verify.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}

api.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
```

Caddy obtains and renews the HTTPS certificates when DNS and inbound ports 80/443 are set up correctly. The API site is needed for static Pages; with Docker-only hosting, the frontend can use the private internal backend and only the first site is needed.

## 8. Nginx example

These minimal server blocks assume certificates are already installed. The verification-site block is for the Docker frontend; the API block is used by static Pages.

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

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

The `api.example.com` server is needed when using static Pages. Keep the published backend port bound to loopback and let Nginx terminate HTTPS. In Docker-only mode, Next.js uses `PUBLIC_BASE_URL` as its origin allow-list and a fixed internal backend address, so a forwarded Host header cannot redirect the API proxy to another service.

## 9. First startup

There are no database migrations or one-time database initialization. Compose starts the backend, then waits for its `/health`; the frontend starts when the backend is healthy. Backend startup validates required configuration, connects to Telegram to validate the token/username, loads translations and begins long polling. The backend health endpoint is `GET /health` (also accepts `HEAD`), returns a `2xx` response and process uptime, and does not expose credentials. On Render, set the Web Service **Health Check Path** to `/health` so Render checks the backend service. Check it directly at the backend host, not at the Cloudflare Pages frontend:

```bash
docker compose ps
curl -fsS http://127.0.0.1:3001/health
# Or, when the backend has its own HTTPS API hostname:
curl -fsS https://api.example.com/health
docker compose logs --tail=100 backend
```

For Docker deployments, Compose probes the backend internally. For static Cloudflare Pages, monitor the public backend API hostname (for example, `https://api.example.com/health`); the frontend’s `/health` file only reports that the static site is being served. The backend health response reports process availability, not Telegram API reachability after startup.

## 10. Verification test

1. Use a test group with join requests enabled and add the bot as an administrator with invite-user permission.
2. From a separate Telegram account, request to join the group.
3. Confirm the bot sends a private message with an in-app verification button and a browser fallback.
4. Open the link in Telegram or a mobile browser and complete the Turnstile challenge. With Cloudflare Pages, verify the browser can reach `NEXT_PUBLIC_BACKEND_BASE_URL` and that the frontend origin is allowed by backend CORS.
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
| Verification URL does not open | Check DNS, `PUBLIC_BASE_URL`, proxy upstream and frontend availability. For static Pages, check the Pages domain separately from backend `https://api.example.com/health`. |
| HTTPS or Telegram Web App error | Use a valid public HTTPS certificate. HTTP localhost is only suitable for local development, not Telegram production use. |
| Invalid token | A restart, secret rotation, malformed query, altered URL or replay can invalidate a ticket. Ask the user to start a fresh join request. |
| Expired verification | Tickets expire after `VERIFICATION_TTL` seconds. Retry with a new request; do not extend the URL lifetime in the browser. |
| API connection failed | Docker mode: check backend health and the fixed `http://backend:3000` address on the Compose network. Static Pages mode: check `NEXT_PUBLIC_BACKEND_BASE_URL`, backend HTTPS, and DNS; never derive the backend URL from request/user input. |
| Browser reports a CORS error | Set backend `PUBLIC_BASE_URL` to the exact Pages website origin. Add any needed Pages preview origins to `CORS_ALLOWED_ORIGINS` as a comma-separated exact list, then restart the backend. |
| Telegram API error | Check Telegram reachability, bot admin rights, API service status and sanitized backend logs. Retryable transport or server failures are retried a bounded number of times. |
| Reverse proxy error | Verify TLS, the upstream host port, and forwarded protocol settings. Keep backend host publishing on loopback and proxy `api.example.com` to port 3001 for static Pages. |
| Database unavailable | This app has no database. Remove stale database environment settings from external wrappers and check backend memory/service health instead. |

Avoid posting full verification URLs, bot tokens, Telegram login payloads or CAPTCHA secrets in logs or support requests.
