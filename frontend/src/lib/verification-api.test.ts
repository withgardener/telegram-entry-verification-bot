import assert from "node:assert/strict";
import test from "node:test";
import { prepareVerificationRequest } from "./verification-api";

const query = {
  chat_id: "-100123",
  msg_id: "8",
  user_id: "42",
  timestamp: "1800000000000",
  nonce: "1234567890123456789012",
  signature: "a".repeat(64)
};

test("uses the same-origin API for the self-hosted Next.js deployment", () => {
  const request = prepareVerificationRequest({ kind: "status", request_query: query }, "");
  assert.equal(request.url, "/api/verify");
  assert.deepEqual(JSON.parse(String(request.init.body)), { kind: "status", request_query: query });
});

test("static hosting calls the public backend verification status endpoint", () => {
  const request = prepareVerificationRequest({ kind: "status", request_query: query }, "https://api.example.test/");
  assert.equal(request.url, "https://api.example.test/endpoints/verification/status");
  assert.deepEqual(JSON.parse(String(request.init.body)), { request_query: query });
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.cache, "no-store");
});

test("static hosting maps browser fallback verification to the matching backend endpoint", () => {
  const login = { id: 42, first_name: "Tester", auth_date: 1_800_000_000, hash: "signed" };
  const request = prepareVerificationRequest({ kind: "complete", fallback: true, token: "challenge", tglogin: login, request_query: query }, "https://api.example.test");
  assert.equal(request.url, "https://api.example.test/endpoints/verify-captcha-fallback");
  assert.deepEqual(JSON.parse(String(request.init.body)), { request_query: query, token: "challenge", tglogin: login });
});

test("rejects non-HTTPS or path-bearing public backend URLs", () => {
  assert.throws(() => prepareVerificationRequest({ kind: "status", request_query: query }, "http://api.example.test"), /HTTPS origin/);
  assert.throws(() => prepareVerificationRequest({ kind: "status", request_query: query }, "https://api.example.test/private"), /HTTPS origin/);
});
