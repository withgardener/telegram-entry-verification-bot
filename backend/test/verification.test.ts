import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { verifyTelegramLoginWidget, verifyWebAppInitData } from "../src/telegram-auth.js";
import { VerificationStore } from "../src/verification.js";

const secret = "this is a stable test-only signing secret of 40 bytes";
const now = 1_800_000_000_000;

function queryFor(ticket: ReturnType<VerificationStore["create"]>): Record<string, string | number> {
  return {
    chat_id: ticket.chatId,
    msg_id: ticket.messageId,
    user_id: ticket.userId,
    private_chat_id: ticket.privateChatId,
    timestamp: ticket.timestamp,
    nonce: ticket.nonce ?? "",
    signature: ticket.signature
  };
}

test("verification tickets are bound to one candidate and claimed once", () => {
  const store = new VerificationStore(secret, 180);
  const issued = store.create(-100123, 88, 42, now);
  const query = queryFor(issued);

  assert.equal(store.inspect(query, 42, now).status, "pending");
  assert.equal(store.inspect(query, 43, now).status, "invalid");
  assert.equal(store.claim(query, 42, now).claimed, true);
  assert.equal(store.claim(query, 42, now).claimed, undefined);
  store.finish(query, 42, "approved", false);
  assert.equal(store.inspect(query, 42, now + 181_000).status, "approved");
});

test("tampered, malformed, and expired verification tickets are rejected", () => {
  const store = new VerificationStore(secret, 180);
  const issued = store.create(-100123, 88, 42, now);
  const query = queryFor(issued);
  assert.equal(store.inspect({ ...query, signature: "0".repeat(64) }, 42, now).status, "invalid");
  assert.equal(store.inspect({ ...query, nonce: "short" }, 42, now).status, "invalid");
  assert.equal(store.inspect({ ...query, private_chat_id: 999 }, 42, now).status, "invalid");
  assert.equal(store.inspect(query, 42, now + 181_000).status, "expired");
});

test("legacy signed links remain compatible during their short TTL and are one-use", () => {
  const store = new VerificationStore(secret, 180);
  const legacy = { chat_id: -100123, msg_id: 21, user_id: 42, timestamp: now };
  const signature = createHmac("sha256", secret).update("21, -100123, 42, 1800000000000").digest("hex");
  const query = { ...legacy, signature };

  assert.equal(store.inspect(query, 42, now).status, "pending");
  assert.equal(store.claim(query, 42, now).claimed, true);
  store.finish(query, 42, "approved", true);
  assert.equal(store.inspect(query, 42, now + 181_000).status, "approved");
  assert.equal(store.inspect(query, 42, now + 24 * 60 * 60 * 1000).status, "approved");
});

test("Telegram Web App and Login Widget hashes are verified with freshness checks", () => {
  const token = "123456:mock-bot-token-for-unit-tests";
  const nowSeconds = 1_800_000_000;
  const webApp: Record<string, string | number> = {
    auth_date: nowSeconds,
    query_id: "AAEAAAE",
    user: JSON.stringify({ id: 42, first_name: "Test" })
  };
  const webAppSecret = createHmac("sha256", "WebAppData").update(token).digest();
  const webAppCheck = Object.keys(webApp).sort().map((key) => `${key}=${webApp[key]}`).join("\n");
  webApp.hash = createHmac("sha256", webAppSecret).update(webAppCheck).digest("hex");
  assert.equal(verifyWebAppInitData(webApp, token, nowSeconds), true);
  assert.equal(verifyWebAppInitData({ ...webApp, user: "{}" }, token, nowSeconds), false);
  assert.equal(verifyWebAppInitData(webApp, token, nowSeconds + 86_401), false);

  const login: Record<string, string | number> = { auth_date: nowSeconds, first_name: "Test", id: 42 };
  const loginSecret = createHash("sha256").update(token).digest();
  const loginCheck = Object.keys(login).sort().map((key) => `${key}=${login[key]}`).join("\n");
  const loginData = { ...login, hash: createHmac("sha256", loginSecret).update(loginCheck).digest("hex") };
  assert.equal(verifyTelegramLoginWidget(loginData as { id: number; first_name: string; auth_date: number; hash: string }, token, nowSeconds), true);
});

test("configuration fails fast and enforces strong secrets and explicit HTTPS origins", () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN/);
  const base = {
    TELEGRAM_BOT_TOKEN: "123456:mock-bot-token",
    TELEGRAM_BOT_USERNAME: "ExampleWatchdogBot",
    PUBLIC_BASE_URL: "https://verify.example.com",
    VERIFICATION_SECRET: secret,
    TURNSTILE_SECRET_KEY: "test-turnstile-key",
    NODE_ENV: "production"
  };
  assert.equal(loadConfig(base).publicBaseUrl.origin, "https://verify.example.com");
  assert.throws(() => loadConfig({ ...base, VERIFICATION_SECRET: "short" }), /32 bytes/);
  assert.throws(() => loadConfig({ ...base, PUBLIC_BASE_URL: "http://verify.example.com" }), /HTTPS/);
});
