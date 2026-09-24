function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const publicUrl = new URL(required("PUBLIC_BASE_URL"));
  const localHttp = process.env.NODE_ENV !== "production" && publicUrl.hostname === "localhost" && publicUrl.protocol === "http:";
  if ((publicUrl.protocol !== "https:" && !localHttp) || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin without a path, query, or fragment");
  }
  const backendUrl = new URL(required("BACKEND_BASE_URL"));
  if (!new Set(["http:", "https:"]).has(backendUrl.protocol) || backendUrl.username || backendUrl.password || backendUrl.search || backendUrl.hash) {
    throw new Error("BACKEND_BASE_URL must be an internal HTTP(S) origin without credentials or query parameters");
  }
  required("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  const botUsername = required("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) throw new Error("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME must be a valid Telegram bot username");
}
