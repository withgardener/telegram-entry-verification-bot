import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const forwarded = [];
const backend = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  forwarded.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "pending", expires_in: 45 }));
});

await new Promise((resolve, reject) => {
  backend.once("error", reject);
  backend.listen(0, "127.0.0.1", resolve);
});

const backendAddress = backend.address();
assert.ok(backendAddress && typeof backendAddress !== "string");
const frontendPort = await freePort();
const publicOrigin = "https://verify.example.test";
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(frontendPort),
    HOSTNAME: "127.0.0.1",
    PUBLIC_BASE_URL: publicOrigin,
    BACKEND_BASE_URL: `http://127.0.0.1:${backendAddress.port}`,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: "ExampleWatchdogBot",
    NEXT_TELEMETRY_DISABLED: "1"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });

async function getReady() {
  const base = `http://127.0.0.1:${frontendPort}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited early (${child.exitCode}): ${output}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return base;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Next.js did not become healthy: ${output}`);
}

try {
  const base = await getReady();
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Entry verification/);

  const verificationPage = await fetch(`${base}/verify`);
  assert.equal(verificationPage.status, 200);
  assert.match(await verificationPage.text(), /Entry verification/);

  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { status: "ok", service: "telegram-entry-verification-frontend" });

  const proxyResponse = await fetch(`${base}/api/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: publicOrigin },
    body: JSON.stringify({ kind: "status", request_query: { chat_id: "-100123", msg_id: "7", timestamp: "1800000000000", signature: "0".repeat(64) } })
  });
  assert.equal(proxyResponse.status, 200);
  assert.deepEqual(await proxyResponse.json(), { status: "pending", expires_in: 45 });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].url, "/endpoints/verification/status");
  assert.equal(forwarded[0].body.request_query.msg_id, "7");

  const wrongOrigin = await fetch(`${base}/api/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ kind: "status", request_query: { chat_id: "-100123", msg_id: "7", timestamp: "1800000000000", signature: "0".repeat(64) } })
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(forwarded.length, 1);
  process.stdout.write("Frontend page, health endpoint, and backend API proxy smoke tests passed.\n");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await new Promise((resolve) => backend.close(resolve));
}
