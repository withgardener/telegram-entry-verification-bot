import "dotenv/config";

export interface AppConfig {
  botToken: string;
  botUsername: string;
  publicBaseUrl: URL;
  corsAllowedOrigins: string[];
  verificationSecret: string;
  verificationTtlSeconds: number;
  turnstileSecretKey: string;
  port: number;
  nodeEnv: "development" | "production" | "test";
}

function value(env: NodeJS.ProcessEnv, key: string, legacy?: string): string | undefined {
  const current = env[key]?.trim();
  if (current) return current;
  const old = legacy ? env[legacy]?.trim() : undefined;
  if (old) {
    console.warn(JSON.stringify({ level: "warn", event: "deprecated_environment_variable", variable: legacy, replacement: key }));
    return old;
  }
  return undefined;
}

function required(env: NodeJS.ProcessEnv, key: string, legacy?: string): string {
  const result = value(env, key, legacy);
  if (!result) throw new Error(`Missing required environment variable: ${key}`);
  return result;
}

function positiveInteger(raw: string, key: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${key} must be an integer between ${min} and ${max}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const botToken = required(env, "TELEGRAM_BOT_TOKEN", "TGWD_TOKEN");
  const botUsername = required(env, "TELEGRAM_BOT_USERNAME").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) throw new Error("TELEGRAM_BOT_USERNAME must be the bot username without an @ sign");

  let publicUrlInput = value(env, "PUBLIC_BASE_URL", "TGWD_FRONTEND_DOMAIN");
  if (publicUrlInput && !publicUrlInput.includes("://")) publicUrlInput = `https://${publicUrlInput}`;
  if (!publicUrlInput) throw new Error("Missing required environment variable: PUBLIC_BASE_URL");

  let publicBaseUrl: URL;
  try { publicBaseUrl = new URL(publicUrlInput); }
  catch { throw new Error("PUBLIC_BASE_URL must be an absolute HTTPS URL"); }
  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "production" && nodeEnv !== "test") throw new Error("NODE_ENV must be development, production, or test");
  const localHttp = nodeEnv !== "production" && publicBaseUrl.hostname === "localhost" && publicBaseUrl.protocol === "http:";
  if (publicBaseUrl.protocol !== "https:" && !localHttp) throw new Error("PUBLIC_BASE_URL must use HTTPS outside local development");
  if (publicBaseUrl.username || publicBaseUrl.password || publicBaseUrl.search || publicBaseUrl.hash || !["", "/"].includes(publicBaseUrl.pathname)) {
    throw new Error("PUBLIC_BASE_URL must contain only the public origin, without credentials, path, query, or fragment");
  }

  const corsAllowedOrigins = new Set([publicBaseUrl.origin]);
  for (const configuredOrigin of (env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)) {
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(configuredOrigin); }
    catch { throw new Error("CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTPS origins"); }
    const localCorsHttp = nodeEnv !== "production" && parsedOrigin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
    if ((parsedOrigin.protocol !== "https:" && !localCorsHttp) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash || !["", "/"].includes(parsedOrigin.pathname)) {
      throw new Error("CORS_ALLOWED_ORIGINS entries must be HTTPS origins without credentials, paths, queries, or fragments");
    }
    corsAllowedOrigins.add(parsedOrigin.origin);
  }

  const verificationSecret = required(env, "VERIFICATION_SECRET", "TGWD_SECRET");
  if (Buffer.byteLength(verificationSecret, "utf8") < 32) throw new Error("VERIFICATION_SECRET must contain at least 32 bytes of random data");

  return {
    botToken,
    botUsername,
    publicBaseUrl: new URL(publicBaseUrl.origin),
    corsAllowedOrigins: [...corsAllowedOrigins],
    verificationSecret,
    verificationTtlSeconds: positiveInteger(env.VERIFICATION_TTL ?? "180", "VERIFICATION_TTL", 60, 900),
    turnstileSecretKey: required(env, "TURNSTILE_SECRET_KEY", "TGWD_CFTS_API_KEY"),
    port: positiveInteger(value(env, "PORT", "TGWD_PORT") ?? "3000", "PORT", 1, 65535),
    nodeEnv
  };
}
