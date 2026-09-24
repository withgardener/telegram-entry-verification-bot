import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { VerificationStore } from "../src/verification.js";

test("backend health and verification API smoke flow", async () => {
  const now = 1_800_000_000_000;
  const token = "123456:mock-bot-token-for-smoke-test";
  const secret = "test-only-verification-secret-with-at-least-32-bytes";
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_BOT_USERNAME: "ExampleWatchdogBot",
    PUBLIC_BASE_URL: "https://verify.example.test",
    VERIFICATION_SECRET: secret,
    VERIFICATION_TTL: "180",
    TURNSTILE_SECRET_KEY: "test-only-turnstile-secret",
    CORS_ALLOWED_ORIGINS: "https://preview.example.test",
    PORT: "3000",
    NODE_ENV: "test"
  });
  const store = new VerificationStore(secret, 180);
  let approved = 0;
  let declined = 0;
  let removed = 0;
  const app = createHttpApp({
    config,
    store,
    now: () => now,
    captcha: async (responseToken) => responseToken === "invalid-captcha" ? { kind: "invalid" } : { kind: "success" },
    telegram: {
      approve: async () => { approved += 1; },
      decline: async () => { declined += 1; },
      deleteMessage: async () => { removed += 1; }
    }
  });
  const server = createServer(app.callback());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { status: string; service: string; uptime_seconds: number };
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.service, "telegram-entry-verification-backend");
    assert.ok(Number.isInteger(healthBody.uptime_seconds) && healthBody.uptime_seconds >= 0);
    const headHealth = await fetch(`${base}/health`, { method: "HEAD" });
    assert.equal(headHealth.status, 200);
    assert.equal(await headHealth.text(), "");

    const preflight = await fetch(`${base}/endpoints/verify-captcha`, {
      method: "OPTIONS",
      headers: {
        origin: "https://preview.example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://preview.example.test");
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);

    const blockedOrigin = await fetch(`${base}/endpoints/verification/status`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ request_query: {} })
    });
    assert.equal(blockedOrigin.status, 403);
    assert.deepEqual(await blockedOrigin.json(), { message: "ORIGIN_NOT_ALLOWED" });

    const valid = store.create(-100123, 88, 42, now);
    const query = { chat_id: valid.chatId, msg_id: valid.messageId, user_id: valid.userId, private_chat_id: valid.privateChatId, timestamp: valid.timestamp, nonce: valid.nonce, signature: valid.signature };
    const invalid = await post("/endpoints/verification/status", { request_query: { ...query, signature: "0".repeat(64) } });
    assert.equal(invalid.status, 400);

    const expired = store.create(-100123, 89, 43, now - 181_000);
    const expiredResponse = await post("/endpoints/verification/status", {
      request_query: { chat_id: expired.chatId, msg_id: expired.messageId, user_id: expired.userId, private_chat_id: expired.privateChatId, timestamp: expired.timestamp, nonce: expired.nonce, signature: expired.signature }
    });
    assert.equal(expiredResponse.status, 410);
    assert.equal(declined, 1);

    const initData: Record<string, string | number> = {
      auth_date: Math.floor(now / 1000),
      query_id: "test-query",
      user: JSON.stringify({ id: 42, first_name: "Test" })
    };
    const webAppSecret = createHmac("sha256", "WebAppData").update(token).digest();
    const checkString = Object.keys(initData).sort().map((key) => `${key}=${initData[key]}`).join("\n");
    initData.hash = createHmac("sha256", webAppSecret).update(checkString).digest("hex");
    const invalidCompletion = await post("/endpoints/verify-captcha", {
      token: "mock-turnstile-response", tglogin: initData,
      request_query: { ...query, signature: "0".repeat(64) }
    });
    assert.equal(invalidCompletion.status, 400);
    assert.equal(approved, 0);

    const completed = await post("/endpoints/verify-captcha", { token: "mock-turnstile-response", tglogin: initData, request_query: query });
    assert.equal(completed.status, 200);
    assert.deepEqual(await completed.json(), { status: "verified" });
    assert.equal(approved, 1);
    assert.equal(removed, 2);

    const replay = await post("/endpoints/verify-captcha", { token: "another-mock-response", tglogin: initData, request_query: query });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { message: "ALREADY_VERIFIED" });
    assert.equal(approved, 1);

    const rejectedTicket = store.create(-100123, 90, 44, now);
    const rejectedQuery = {
      chat_id: rejectedTicket.chatId, msg_id: rejectedTicket.messageId, user_id: rejectedTicket.userId,
      private_chat_id: rejectedTicket.privateChatId, timestamp: rejectedTicket.timestamp,
      nonce: rejectedTicket.nonce, signature: rejectedTicket.signature
    };
    const rejectedIdentity: Record<string, string | number> = {
      auth_date: Math.floor(now / 1000), query_id: "test-query-rejected", user: JSON.stringify({ id: 44, first_name: "Test" })
    };
    const rejectedCheck = Object.keys(rejectedIdentity).sort().map((key) => `${key}=${rejectedIdentity[key]}`).join("\n");
    rejectedIdentity.hash = createHmac("sha256", webAppSecret).update(rejectedCheck).digest("hex");
    const rejected = await post("/endpoints/verify-captcha", {
      token: "invalid-captcha", tglogin: rejectedIdentity, request_query: rejectedQuery
    });
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { message: "CAPTCHA_NOT_PASSED" });
    assert.equal(approved, 1);
    assert.equal(declined, 2);
    assert.equal(removed, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
