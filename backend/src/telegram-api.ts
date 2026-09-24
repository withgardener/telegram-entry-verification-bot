function errorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("error_code" in error)) return undefined;
  const code = (error as { error_code?: unknown }).error_code;
  return typeof code === "number" ? code : undefined;
}

function retryAfterSeconds(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("parameters" in error)) return undefined;
  const value = (error as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class TelegramServiceError extends Error {
  constructor(readonly retryable: boolean, options?: ErrorOptions) {
    super("Telegram API request failed", options);
    this.name = "TelegramServiceError";
  }
}

export async function withTelegramRetry<T>(operation: () => Promise<T>, label: string, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = errorCode(error);
      const retryable = code === undefined || code === 429 || code >= 500;
      console.warn(JSON.stringify({ level: "warn", event: "telegram_api_error", operation: label, attempt: attempt + 1, errorCode: code }));
      if (!retryable || attempt === 2) throw new TelegramServiceError(retryable, { cause: error });
      const retryAfter = retryAfterSeconds(error);
      const backoffMs = retryAfter !== undefined ? Math.min(10_000, Math.max(250, retryAfter * 1000)) : 500 * 2 ** attempt;
      await sleep(backoffMs);
    }
  }
  throw new TelegramServiceError(true, { cause: lastError });
}
