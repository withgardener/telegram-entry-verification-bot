import assert from "node:assert/strict";
import test from "node:test";
import { apiStateToViewState, readRequestQuery } from "./verification";

test("reads the signed ticket shape and rejects malformed identifiers", () => {
  const valid = new URLSearchParams("chat_id=-100123&msg_id=3&user_id=42&private_chat_id=42&timestamp=1000&nonce=1234567890123456789012&signature=abc&fallback=1");
  assert.equal(readRequestQuery(valid)?.fallback, "1");
  assert.equal(readRequestQuery(new URLSearchParams("chat_id=x&msg_id=3&user_id=42&timestamp=1000&signature=abc")), undefined);
});

test("maps verification API outcomes to clear UI states", () => {
  assert.equal(apiStateToViewState(200, undefined, "pending"), "captcha");
  assert.equal(apiStateToViewState(200, undefined, "verified"), "success");
  assert.equal(apiStateToViewState(200, "ALREADY_VERIFIED"), "already_verified");
  assert.equal(apiStateToViewState(410, "REQUEST_EXPIRED"), "expired");
  assert.equal(apiStateToViewState(403, "CAPTCHA_NOT_PASSED"), "rejected");
  assert.equal(apiStateToViewState(502, "API_UNAVAILABLE"), "error");
});
