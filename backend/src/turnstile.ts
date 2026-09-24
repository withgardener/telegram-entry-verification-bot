export type TurnstileResult = { kind: "success" } | { kind: "invalid" } | { kind: "unavailable" };

export async function verifyTurnstile(responseToken: string, secretKey: string, expectedHostname: string, fetcher: typeof fetch = fetch): Promise<TurnstileResult> {
  let response: Response;
  try {
    const body = new URLSearchParams({ secret: secretKey, response: responseToken });
    response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (!response.ok) return { kind: "unavailable" };
  let data: unknown;
  try { data = await response.json(); }
  catch { return { kind: "unavailable" }; }
  if (typeof data !== "object" || data === null) return { kind: "unavailable" };
  const result = data as { success?: unknown; hostname?: unknown; action?: unknown };
  if (result.success !== true || result.hostname !== expectedHostname || result.action !== "telegram-verification") return { kind: "invalid" };
  return { kind: "success" };
}
