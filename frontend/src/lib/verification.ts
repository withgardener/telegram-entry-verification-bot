export type VerificationViewState = "waiting" | "loading" | "captcha" | "success" | "rejected" | "expired" | "already_verified" | "error";

export interface RequestQuery {
  chat_id: string;
  msg_id: string;
  user_id: string;
  private_chat_id?: string;
  timestamp: string;
  nonce?: string;
  signature: string;
  fallback?: string;
}

export function readRequestQuery(search: URLSearchParams): RequestQuery | undefined {
  const chatId = search.get("chat_id");
  const messageId = search.get("msg_id");
  const userId = search.get("user_id");
  const privateChatId = search.get("private_chat_id") ?? undefined;
  const timestamp = search.get("timestamp");
  const signature = search.get("signature");
  if (!chatId || !messageId || !userId || !timestamp || !signature || signature.length > 128) return undefined;
  if (!/^-?\d+$/.test(chatId) || !/^\d+$/.test(messageId) || !/^\d+$/.test(userId) || !/^\d+$/.test(timestamp)) return undefined;
  const nonce = search.get("nonce") ?? undefined;
  if (nonce && !/^[A-Za-z0-9_-]{22}$/.test(nonce)) return undefined;
  if (privateChatId && !/^-?\d+$/.test(privateChatId)) return undefined;
  return { chat_id: chatId, msg_id: messageId, user_id: userId, private_chat_id: privateChatId, timestamp, nonce, signature, fallback: search.get("fallback") ?? undefined };
}

export function apiStateToViewState(status: number, message: string | undefined, resultStatus?: string): VerificationViewState {
  if (resultStatus === "pending") return "captcha";
  if (resultStatus === "verified") return "success";
  if (resultStatus === "already_verified") return "already_verified";
  if (resultStatus === "processing" || status === 202) return "loading";
  if (message === "ALREADY_VERIFIED") return "already_verified";
  if (message === "REQUEST_EXPIRED") return "expired";
  if (message === "VERIFICATION_REJECTED" || message === "CAPTCHA_NOT_PASSED") return "rejected";
  if (status === 503 && (message === "CAPTCHA_ERROR" || message === "TELEGRAM_API_UNAVAILABLE")) return "captcha";
  if (status === 200 && resultStatus === "pending") return "captcha";
  return "error";
}
