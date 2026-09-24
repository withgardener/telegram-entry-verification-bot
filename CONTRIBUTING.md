# Contributing

Thanks for helping improve Telegram Entry Verification Bot. Keep changes focused, preserve the Telegram join-request flow, and avoid adding infrastructure or runtime dependencies without a clear need.

## Development

- Use Node.js 24 LTS and npm.
- Backend and frontend are independent packages; install and run checks from their respective directories.
- Backend local startup requires a bot token, bot username, HTTPS public origin (or localhost for development), a verification secret, and a Turnstile secret.
- Backend tests mock Telegram and CAPTCHA. Do not use production credentials in tests.
- Frontend tests and `npm run smoke` use local fixtures and need no external accounts.

Before opening a pull request, run:

```text
backend:  npm ci, npm run lint, npm run typecheck, npm test, npm run build
frontend: npm ci, npm run lint, npm run typecheck, npm test, npm run build, npm run smoke
```

The CI workflow runs the same checks for pull requests and pushes to `main`. Do not commit `.env` files, tokens, login payloads, build output or `node_modules`.

## Changes to Telegram behavior

Include tests for token validation, expiry, replay, retries, or state changes when altering the verification flow. Keep the backend as an independent long-running service. Avoid logging Telegram credentials, full verification URLs, user login payloads, or CAPTCHA tokens.

## Localization

Bot translations are stored under `backend/locales`. Preserve the locale license and contributor notices when editing these files.
