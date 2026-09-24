export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status: number): Response {
  return Response.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

function backendOrigin(): URL | undefined {
  const value = process.env.BACKEND_BASE_URL;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return undefined;
    return new URL(url.origin);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const publicOrigin = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : "";
      if (!publicOrigin || new URL(origin).origin !== publicOrigin) return jsonError("ORIGIN_NOT_ALLOWED", 403);
    } catch {
      return jsonError("SERVER_UNAVAILABLE", 500);
    }
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return jsonError("JSON_REQUIRED", 415);
  const raw = await request.text();
  if (raw.length > 32_768) return jsonError("REQUEST_TOO_LARGE", 413);
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; }
  catch { return jsonError("INVALID_JSON", 400); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return jsonError("INVALID_REQUEST", 400);
  const input = body as Record<string, unknown>;
  if ((input.kind !== "status" && input.kind !== "complete") || typeof input.request_query !== "object" || input.request_query === null || Array.isArray(input.request_query)) {
    return jsonError("INVALID_REQUEST", 400);
  }
  if (input.kind === "complete" && (typeof input.token !== "string" || typeof input.fallback !== "boolean" || !input.tglogin || typeof input.tglogin !== "object")) {
    return jsonError("INVALID_REQUEST", 400);
  }

  const backend = backendOrigin();
  if (!backend) return jsonError("SERVER_UNAVAILABLE", 503);
  const endpoint = input.kind === "status"
    ? "/endpoints/verification/status"
    : input.fallback === true ? "/endpoints/verify-captcha-fallback" : "/endpoints/verify-captcha";
  try {
    const upstream = await fetch(new URL(endpoint, backend), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.kind === "status" ? { request_query: input.request_query } : {
        request_query: input.request_query,
        token: input.token,
        tglogin: input.tglogin
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000)
    });
    const text = await upstream.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) as unknown : {}; }
    catch { data = { message: "SERVER_UNAVAILABLE" }; }
    return Response.json(data, { status: upstream.status, headers: { "cache-control": "no-store" } });
  } catch {
    return jsonError("API_UNAVAILABLE", 502);
  }
}
