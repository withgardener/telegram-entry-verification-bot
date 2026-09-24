import Koa from "koa";
import Router from "@koa/router";
import type { AppConfig } from "./config.js";
import { verifyTelegramLoginWidget, verifyWebAppInitData, type TelegramLoginData } from "./telegram-auth.js";
import { TelegramServiceError } from "./telegram-api.js";
import { verifyTurnstile, type TurnstileResult } from "./turnstile.js";
import { parseTicketQuery, VerificationStore } from "./verification.js";

declare module "koa" {
  interface DefaultState { requestBody?: unknown }
}

export interface TelegramActions {
  approve(chatId: number, userId: number): Promise<void>;
  decline(chatId: number, userId: number): Promise<void>;
  deleteMessage(privateChatId: number, messageId: number): Promise<void>;
}

export interface HttpDependencies {
  config: AppConfig;
  store: VerificationStore;
  telegram: TelegramActions;
  captcha?: (token: string) => Promise<TurnstileResult>;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWebAppData(value: unknown): Record<string, string | number> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if ((typeof item !== "string" && typeof item !== "number") || key.length > 100 || String(item).length > 4096) return undefined;
    result[key] = item;
  }
  return result;
}

function messageFor(status: string): { code: string; httpStatus: number } {
  switch (status) {
    case "invalid": return { code: "INVALID_REQUEST", httpStatus: 400 };
    case "expired": return { code: "REQUEST_EXPIRED", httpStatus: 410 };
    case "rejected": return { code: "VERIFICATION_REJECTED", httpStatus: 409 };
    case "approved": return { code: "ALREADY_VERIFIED", httpStatus: 200 };
    case "processing": return { code: "VERIFICATION_IN_PROGRESS", httpStatus: 202 };
    default: return { code: "SERVER_UNAVAILABLE", httpStatus: 500 };
  }
}

function setNoStore(ctx: Koa.Context): void {
  ctx.set("Cache-Control", "no-store");
  ctx.set("X-Content-Type-Options", "nosniff");
}

async function jsonBody(ctx: Koa.Context, next: Koa.Next): Promise<void> {
  if (ctx.method !== "POST") {
    await next();
    return;
  }
  if (!ctx.is("application/json")) {
    ctx.status = 415;
    ctx.body = { message: "JSON_REQUIRED" };
    return;
  }
  const declaredLength = Number(ctx.get("content-length") || "0");
  if (declaredLength > 32_768) {
    ctx.status = 413;
    ctx.body = { message: "REQUEST_TOO_LARGE" };
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 32_768) {
      ctx.status = 413;
      ctx.body = { message: "REQUEST_TOO_LARGE" };
      return;
    }
    chunks.push(buffer);
  }
  try {
    ctx.state.requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    ctx.status = 400;
    ctx.body = { message: "INVALID_JSON" };
    return;
  }
  await next();
}

export function createHttpApp(deps: HttpDependencies): Koa {
  const app = new Koa();
  const router = new Router();
  const now = deps.now ?? Date.now;
  const captcha = deps.captcha ?? ((token: string) => verifyTurnstile(token, deps.config.turnstileSecretKey, deps.config.publicBaseUrl.hostname));

  app.proxy = false;
  app.use(async (ctx, next) => {
    setNoStore(ctx);
    try {
      await next();
    } catch {
      console.error(JSON.stringify({ level: "error", event: "http_request_failed", method: ctx.method, path: ctx.path }));
      ctx.status = 500;
      ctx.body = { message: "SERVER_UNAVAILABLE" };
    }
  });
  app.use(jsonBody);

  router.get("/health", (ctx) => {
    ctx.status = 200;
    ctx.body = { status: "ok", service: "telegram-entry-verification-backend" };
  });
  router.get("/endpoints", (ctx) => {
    ctx.body = { status: "ok" };
  });

  router.post("/endpoints/verification/status", async (ctx) => {
    const body = ctx.state.requestBody;
    const requestQuery = isRecord(body) ? body.request_query : undefined;
    const ticket = parseTicketQuery(requestQuery);
    const inspection = deps.store.inspect(requestQuery, ticket?.userId, now());
    if (inspection.status === "expired" && ticket?.userId !== undefined) {
      await deps.telegram.decline(ticket.chatId, ticket.userId).catch(() => undefined);
      await deps.telegram.deleteMessage(ticket.privateChatId ?? ticket.userId, ticket.messageId).catch(() => undefined);
    }
    const result = inspection.status === "pending"
      ? { status: "pending", expires_in: Math.max(0, Math.ceil(((inspection.expiresAt ?? now()) - now()) / 1000)) }
      : inspection.status === "approved"
        ? { status: "already_verified" }
        : inspection.status === "processing"
          ? { status: "processing" }
          : { message: messageFor(inspection.status).code };
    ctx.status = messageFor(inspection.status).httpStatus;
    ctx.body = result;
  });

  const completeVerification = async (ctx: Koa.Context, fallback: boolean): Promise<void> => {
    const body = ctx.state.requestBody;
    if (!isRecord(body) || typeof body.token !== "string" || body.token.length < 1 || body.token.length > 4096 || !isRecord(body.request_query)) {
      ctx.status = 400;
      ctx.body = { message: "INVALID_REQUEST" };
      return;
    }
    const ticket = parseTicketQuery(body.request_query);
    if (!ticket) {
      ctx.status = 400;
      ctx.body = { message: "INVALID_REQUEST" };
      return;
    }

    let userId: number;
    let accountValid: boolean;
    if (fallback) {
      const login = body.tglogin as Partial<TelegramLoginData> | undefined;
      if (!login || typeof login !== "object" || typeof login.id !== "number" || !Number.isSafeInteger(login.id) ||
          typeof login.first_name !== "string" || typeof login.auth_date !== "number" || typeof login.hash !== "string") {
        ctx.status = 400;
        ctx.body = { message: "TELEGRAM_LOGIN_INVALID" };
        return;
      }
      userId = login.id;
      accountValid = verifyTelegramLoginWidget(login as TelegramLoginData, deps.config.botToken, Math.floor(now() / 1000));
    } else {
      const initData = normalizeWebAppData(body.tglogin);
      if (!initData || typeof initData.user !== "string") {
        ctx.status = 400;
        ctx.body = { message: "TELEGRAM_ACCOUNT_INFO_ERROR" };
        return;
      }
      let user: unknown;
      try { user = JSON.parse(initData.user) as unknown; }
      catch {
        ctx.status = 400;
        ctx.body = { message: "TELEGRAM_ACCOUNT_INFO_ERROR" };
        return;
      }
      if (!isRecord(user) || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || !verifyWebAppInitData(initData, deps.config.botToken, Math.floor(now() / 1000))) {
        ctx.status = 401;
        ctx.body = { message: "TELEGRAM_ACCOUNT_INFO_ERROR" };
        return;
      }
      userId = user.id;
      accountValid = true;
    }
    if (!accountValid || (ticket.userId !== undefined && ticket.userId !== userId)) {
      ctx.status = 400;
      ctx.body = { message: "USER_ID_MISMATCH" };
      return;
    }

    const claim = deps.store.claim(body.request_query, userId, now());
    if (claim.status !== "processing" || !claim.claimed) {
      if (claim.status === "expired" && ticket.userId !== undefined) {
        await deps.telegram.decline(ticket.chatId, userId).catch(() => undefined);
        await deps.telegram.deleteMessage(ticket.privateChatId ?? userId, ticket.messageId).catch(() => undefined);
      }
      ctx.status = claim.status === "processing" ? 202 : messageFor(claim.status).httpStatus;
      ctx.body = claim.status === "processing" ? { status: "processing" } : { message: messageFor(claim.status).code };
      return;
    }

    let captchaResult: TurnstileResult;
    try { captchaResult = await captcha(body.token); }
    catch { captchaResult = { kind: "unavailable" }; }
    if (captchaResult.kind === "unavailable") {
      deps.store.release(body.request_query, userId, claim.legacy);
      ctx.status = 503;
      ctx.body = { message: "CAPTCHA_ERROR" };
      return;
    }
    if (captchaResult.kind === "invalid") {
      deps.store.finish(body.request_query, userId, "rejected", claim.legacy);
      await deps.telegram.decline(ticket.chatId, userId).catch(() => undefined);
      await deps.telegram.deleteMessage(ticket.privateChatId ?? userId, ticket.messageId).catch(() => undefined);
      ctx.status = 403;
      ctx.body = { message: "CAPTCHA_NOT_PASSED" };
      return;
    }

    try {
      await deps.telegram.approve(ticket.chatId, userId);
      deps.store.finish(body.request_query, userId, "approved", claim.legacy);
      await deps.telegram.deleteMessage(ticket.privateChatId ?? userId, ticket.messageId).catch(() => undefined);
      ctx.status = 200;
      ctx.body = { status: "verified" };
    } catch (error) {
      if (error instanceof TelegramServiceError && error.retryable) {
        deps.store.release(body.request_query, userId, claim.legacy);
        ctx.status = 503;
        ctx.body = { message: "TELEGRAM_API_UNAVAILABLE" };
        return;
      }
      deps.store.finish(body.request_query, userId, "rejected", claim.legacy);
      await deps.telegram.decline(ticket.chatId, userId).catch(() => undefined);
      await deps.telegram.deleteMessage(ticket.privateChatId ?? userId, ticket.messageId).catch(() => undefined);
      ctx.status = 502;
      ctx.body = { message: "TELEGRAM_API_ERROR" };
    }
  };

  router.post("/endpoints/verify-captcha", async (ctx) => completeVerification(ctx, false));
  router.post("/endpoints/verify-captcha-fallback", async (ctx) => completeVerification(ctx, true));

  app.use(router.routes());
  app.use(router.allowedMethods());
  app.on("error", (_error, ctx) => {
    console.error(JSON.stringify({ level: "error", event: "koa_error", method: ctx?.method, path: ctx?.path }));
  });
  return app;
}
