import assert from "node:assert/strict";
import test from "node:test";
import { TelegramServiceError, withTelegramRetry } from "../src/telegram-api.js";

test("Telegram 429 retry honors Retry-After but caps its wait", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await withTelegramRetry(async () => {
    calls += 1;
    if (calls === 1) throw { error_code: 429, parameters: { retry_after: 900 } };
    return "ok";
  }, "test 429", async (ms) => { waits.push(ms); });

  assert.equal(result, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [10_000]);
});

test("Telegram transient failures retry a finite number of times", async () => {
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(
    withTelegramRetry(async () => {
      calls += 1;
      throw { error_code: 503 };
    }, "test 503", async (ms) => { waits.push(ms); }),
    (error: unknown) => error instanceof TelegramServiceError && error.retryable
  );

  assert.equal(calls, 3);
  assert.deepEqual(waits, [500, 1_000]);
});

test("Telegram client errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withTelegramRetry(async () => {
      calls += 1;
      throw { error_code: 400 };
    }, "test 400", async () => { assert.fail("client error must not wait"); }),
    (error: unknown) => error instanceof TelegramServiceError && !error.retryable
  );
  assert.equal(calls, 1);
});
