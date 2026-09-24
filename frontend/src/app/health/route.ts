export function GET(): Response {
  return Response.json({ status: "ok", service: "telegram-entry-verification-frontend" }, { headers: { "cache-control": "no-store" } });
}
