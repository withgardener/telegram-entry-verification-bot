import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const route = join(root, "src", "app", "api", "verify", "route.ts");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_BASE_URL?.trim();

assert.ok(backendUrl, "NEXT_PUBLIC_BACKEND_BASE_URL is required for the static Pages build");
let backendOrigin;
try {
  const parsed = new URL(backendUrl);
  assert.equal(parsed.protocol, "https:", "NEXT_PUBLIC_BACKEND_BASE_URL must use HTTPS");
  assert.equal(parsed.username, "", "NEXT_PUBLIC_BACKEND_BASE_URL cannot contain credentials");
  assert.equal(parsed.password, "", "NEXT_PUBLIC_BACKEND_BASE_URL cannot contain credentials");
  assert.ok(["", "/"].includes(parsed.pathname), "NEXT_PUBLIC_BACKEND_BASE_URL must be an origin without a path");
  assert.equal(parsed.search, "", "NEXT_PUBLIC_BACKEND_BASE_URL cannot contain a query");
  assert.equal(parsed.hash, "", "NEXT_PUBLIC_BACKEND_BASE_URL cannot contain a fragment");
  backendOrigin = parsed.origin;
} catch (error) {
  throw new Error(`Invalid NEXT_PUBLIC_BACKEND_BASE_URL: ${error instanceof Error ? error.message : "expected an HTTPS origin"}`);
}
assert.ok(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim(), "NEXT_PUBLIC_TURNSTILE_SITE_KEY is required");
assert.ok(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim(), "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is required");
assert.ok(existsSync(route), `Expected server-only API route at ${route}`);
assert.ok(statSync(nextBin).isFile(), "Install frontend dependencies before building the static site");

const temporary = mkdtempSync(join(root, ".pages-build-"));
const parkedRoute = join(temporary, "verify-route.ts");
let routeMoved = false;

try {
  renameSync(route, parkedRoute);
  routeMoved = true;
  rmSync(join(root, ".next"), { recursive: true, force: true });
  rmSync(join(root, "out"), { recursive: true, force: true });

  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      CLOUDFLARE_STATIC_EXPORT: "1",
      NEXT_PUBLIC_BACKEND_BASE_URL: backendOrigin,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Static Next.js build failed with exit code ${result.status ?? "unknown"}`);

  assert.ok(existsSync(join(root, "out", "index.html")), "Static build did not produce out/index.html");
  assert.ok(
    existsSync(join(root, "out", "verify.html")) || existsSync(join(root, "out", "verify", "index.html")),
    "Static build did not produce the /verify page"
  );
  assert.ok(!existsSync(join(root, "out", "api", "verify.json")), "The static output must not contain the server API route");
} finally {
  if (routeMoved) {
    mkdirSync(dirname(route), { recursive: true });
    renameSync(parkedRoute, route);
  }
  rmSync(temporary, { recursive: true, force: true });
}
