import { resolve } from "node:path";
import { Bot, Context } from "grammy";
import { Fluent } from "@moebius/fluent";
import { FluentContextFlavor, useFluent } from "@grammyjs/fluent";
import { loadConfig } from "./src/config.js";
import { createHttpApp } from "./src/http.js";
import { TelegramServiceError, withTelegramRetry } from "./src/telegram-api.js";
import { VerificationStore } from "./src/verification.js";

type BotContext = Context & FluentContextFlavor;

const config = loadConfig();
const store = new VerificationStore(config.verificationSecret, config.verificationTtlSeconds);
const bot = new Bot<BotContext>(config.botToken);
const fluent = new Fluent();
const openingRequests = new Set<string>();

function log(level: "info" | "warn" | "error", event: string): void {
  console[level](JSON.stringify({ level, event }));
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function ticketUrl(ticket: ReturnType<VerificationStore["create"]>): URL {
  const url = new URL("/", config.publicBaseUrl);
  url.searchParams.set("chat_id", String(ticket.chatId));
  url.searchParams.set("msg_id", String(ticket.messageId));
  url.searchParams.set("user_id", String(ticket.userId));
  url.searchParams.set("private_chat_id", String(ticket.privateChatId));
  url.searchParams.set("timestamp", String(ticket.timestamp));
  url.searchParams.set("nonce", ticket.nonce ?? "");
  url.searchParams.set("signature", ticket.signature);
  return url;
}

async function loadTranslations(): Promise<void> {
  const localeRoot = resolve(process.cwd(), "locales");
  await Promise.all([
    fluent.addTranslation({ locales: "zh_Hans", filePath: [resolve(localeRoot, "zh-Hans/messages.ftl")] }),
    fluent.addTranslation({ locales: "en", filePath: [resolve(localeRoot, "en/messages.ftl")], isDefault: true }),
    fluent.addTranslation({ locales: "zh_Hant", filePath: [resolve(localeRoot, "zh-Hant/messages.ftl")] }),
    fluent.addTranslation({ locales: "zh_Hant_HK", filePath: [resolve(localeRoot, "zh_HK/messages.ftl")] }),
    fluent.addTranslation({ locales: "ja", filePath: [resolve(localeRoot, "ja/messages.ftl")] }),
    fluent.addTranslation({ locales: "ru", filePath: [resolve(localeRoot, "ru/messages.ftl")] }),
    fluent.addTranslation({ locales: "tr", filePath: [resolve(localeRoot, "tr/messages.ftl")] })
  ]);
}

async function verifyBotMembership(chatId: number, userId: number): Promise<boolean> {
  const member = await withTelegramRetry(() => bot.api.getChatMember(chatId, userId), "check approved member");
  return member.status === "member" || member.status === "administrator" || member.status === "creator" ||
    (member.status === "restricted" && member.is_member);
}

async function approveJoinRequest(chatId: number, userId: number): Promise<void> {
  try {
    await withTelegramRetry(() => bot.api.approveChatJoinRequest(chatId, userId), "approve join request");
  } catch (error) {
    try {
      if (await verifyBotMembership(chatId, userId)) return;
    } catch {
      // The original result remains authoritative when membership cannot be checked.
    }
    if (error instanceof TelegramServiceError) throw error;
    throw new TelegramServiceError(false, { cause: error });
  }
}

async function main(): Promise<void> {
  await loadTranslations();
  bot.use(useFluent({ fluent, defaultLocale: "en" }));

  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await ctx.reply(
      `${ctx.t("welcome_body")}\n${ctx.t("welcome_links_github")} · ${ctx.t("welcome_links_help")} · ${ctx.t("welcome_links_community")}`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: ctx.t("welcome_setmeasadmin"),
            url: `https://t.me/${config.botUsername}?startgroup=start&admin=invite_users`
          }]]
        },
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true }
      }
    );
  });

  bot.on("chat_join_request", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const candidateKey = `${chatId}:${userId}`;
    if (store.hasActiveRequest(chatId, userId) || openingRequests.has(candidateKey)) return;
    openingRequests.add(candidateKey);
    try {
      const privateChatId = ctx.chatJoinRequest.user_chat_id ?? userId;
      const message = await withTelegramRetry(
        () => bot.api.sendMessage(privateChatId, ctx.t("verify_loading")),
        "send verification message"
      );
      const ticket = store.create(chatId, message.message_id, userId, Date.now(), message.chat.id);
      const appUrl = ticketUrl(ticket);
      const browserUrl = new URL(appUrl);
      browserUrl.searchParams.set("fallback", "1");
      const text = `${ctx.t("verify_message", { groupname: escapeHtml(ctx.chat.title ?? "the group") })}\n${ctx.t("verify_info")}\n\n${ctx.t("helpbot")}`;
      await withTelegramRetry(() => bot.api.editMessageText(message.chat.id, message.message_id, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `⚡ ${ctx.t("verify_btn")}`, web_app: { url: appUrl.toString() } }],
            [{ text: `🌍 ${ctx.t("verify_btn_browser")}`, url: browserUrl.toString() }]
          ]
        },
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true }
      }), "update verification message");
      log("info", "verification_request_created");
    } catch {
      log("warn", "verification_request_delivery_failed");
    } finally {
      openingRequests.delete(candidateKey);
    }
  });

  bot.catch(({ ctx }) => {
    log("error", "telegram_update_failed");
    void ctx;
  });

  await bot.init();
  if (bot.botInfo.username?.toLowerCase() !== config.botUsername.toLowerCase()) {
    throw new Error("TELEGRAM_BOT_USERNAME does not match the configured bot token");
  }

  const api = createHttpApp({
    config,
    store,
    telegram: {
      approve: approveJoinRequest,
      decline: async (chatId, userId) => { await withTelegramRetry(() => bot.api.declineChatJoinRequest(chatId, userId), "decline join request"); },
      deleteMessage: async (privateChatId, messageId) => { await withTelegramRetry(() => bot.api.deleteMessage(privateChatId, messageId), "delete verification message"); }
    }
  });
  const server = await new Promise<ReturnType<typeof api.listen>>((resolveServer, reject) => {
    const listening = api.listen(config.port, "0.0.0.0", () => resolveServer(listening));
    listening.once("error", reject);
  });
  log("info", "backend_http_ready");

  void bot.start({ allowed_updates: ["message", "chat_join_request"] }).catch(() => {
    log("error", "telegram_polling_stopped");
    server.close(() => { process.exitCode = 1; });
  });

  const shutdown = (): void => {
    log("info", "backend_shutdown");
    bot.stop();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  const knownConfigurationError = error instanceof Error && /^(Missing required environment variable:|TELEGRAM_BOT_USERNAME|PUBLIC_BASE_URL|VERIFICATION_SECRET|VERIFICATION_TTL|PORT|NODE_ENV)/.test(error.message);
  console.error(JSON.stringify({
    level: "error",
    event: "startup_failed",
    message: knownConfigurationError ? (error as Error).message : "Could not contact Telegram or start the service; check the bot token, network, and bot username."
  }));
  process.exitCode = 1;
});
