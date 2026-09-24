import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type VerificationStatus = "pending" | "processing" | "approved" | "rejected" | "expired";

export interface NormalizedTicket {
  chatId: number;
  messageId: number;
  userId?: number;
  privateChatId?: number;
  timestamp: number;
  signature: string;
  nonce?: string;
}

export interface TicketRecord extends NormalizedTicket {
  userId: number;
  privateChatId: number;
  expiresAt: number;
  status: VerificationStatus;
}

export interface Inspection {
  status: VerificationStatus | "invalid";
  expiresAt?: number;
  legacy: boolean;
  claimed?: boolean;
}

function parseInteger(raw: number | string, label: string): number {
  const asString = String(raw);
  if (!/^-?\d+$/.test(asString)) throw new Error(`Invalid ${label}`);
  const parsed = Number(asString);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

export function parseTicketQuery(input: unknown): NormalizedTicket | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  if ((typeof raw.chat_id !== "number" && typeof raw.chat_id !== "string") ||
      (typeof raw.msg_id !== "number" && typeof raw.msg_id !== "string") ||
      (typeof raw.timestamp !== "number" && typeof raw.timestamp !== "string") ||
      typeof raw.signature !== "string") return undefined;
  try {
    const ticket: NormalizedTicket = {
      chatId: parseInteger(raw.chat_id, "chat_id"),
      messageId: parseInteger(raw.msg_id, "msg_id"),
      timestamp: parseInteger(raw.timestamp, "timestamp"),
      signature: raw.signature
    };
    if (raw.user_id !== undefined) {
      if (typeof raw.user_id !== "number" && typeof raw.user_id !== "string") return undefined;
      ticket.userId = parseInteger(raw.user_id, "user_id");
    }
    if (raw.private_chat_id !== undefined) {
      if (typeof raw.private_chat_id !== "number" && typeof raw.private_chat_id !== "string") return undefined;
      ticket.privateChatId = parseInteger(raw.private_chat_id, "private_chat_id");
    }
    if (raw.nonce !== undefined) {
      if (typeof raw.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(raw.nonce)) return undefined;
      ticket.nonce = raw.nonce;
    }
    if (!/^[a-f0-9]{64}$/i.test(ticket.signature) || ticket.messageId < 1 ||
        (ticket.userId !== undefined && ticket.userId < 1) || (ticket.privateChatId !== undefined && ticket.privateChatId < 1)) return undefined;
    return ticket;
  } catch {
    return undefined;
  }
}

function safeHexEqual(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function keyFor(ticket: Pick<NormalizedTicket, "chatId" | "messageId" | "userId" | "privateChatId">, userId?: number): string {
  return `${ticket.chatId}:${ticket.privateChatId ?? ticket.userId ?? userId}:${ticket.messageId}:${ticket.userId ?? userId}`;
}

export class VerificationStore {
  private readonly records = new Map<string, TicketRecord>();
  private readonly legacyRecords = new Map<string, TicketRecord>();

  constructor(private readonly secret: string, private readonly ttlSeconds: number) {}

  create(chatId: number, messageId: number, userId: number, now = Date.now(), privateChatId = userId): TicketRecord {
    this.prune(now);
    const nonce = randomBytes(16).toString("base64url");
    const record: TicketRecord = {
      chatId, messageId, userId, privateChatId, timestamp: now, nonce,
      signature: this.signV1({ chatId, messageId, userId, privateChatId, timestamp: now, nonce }),
      expiresAt: now + this.ttlSeconds * 1000,
      status: "pending"
    };
    this.records.set(keyFor(record), record);
    return { ...record };
  }

  inspect(input: unknown, expectedUserId?: number, now = Date.now()): Inspection {
    const ticket = parseTicketQuery(input);
    if (!ticket || ticket.timestamp > now + 30_000) return { status: "invalid", legacy: false };
    if (expectedUserId !== undefined && ticket.userId !== undefined && ticket.userId !== expectedUserId) {
      return { status: "invalid", legacy: !ticket.nonce };
    }
    if (ticket.nonce) {
      const userId = expectedUserId ?? ticket.userId;
      if (userId === undefined || (ticket.userId !== undefined && ticket.userId !== userId)) return { status: "invalid", legacy: false };
      const record = this.records.get(keyFor(ticket, userId));
      if (!record || record.nonce !== ticket.nonce || !safeHexEqual(record.signature, ticket.signature)) return { status: "invalid", legacy: false };
      if (record.status === "pending" && now > record.expiresAt) record.status = "expired";
      return { status: record.status, expiresAt: record.expiresAt, legacy: false };
    }

    const userId = expectedUserId ?? ticket.userId;
    if (userId === undefined || (ticket.userId !== undefined && ticket.userId !== userId)) return { status: "invalid", legacy: true };
    const expected = this.signLegacy({ ...ticket, userId });
    if (!safeHexEqual(expected, ticket.signature)) return { status: "invalid", legacy: true };
    const recordKey = keyFor(ticket, userId);
    let record = this.legacyRecords.get(recordKey);
    const expiresAt = ticket.timestamp + this.ttlSeconds * 1000;
    if (!record && now > expiresAt) return { status: "expired", expiresAt, legacy: true };
    if (!record) {
      record = { ...ticket, userId, privateChatId: ticket.privateChatId ?? userId, expiresAt, status: "pending" };
      this.legacyRecords.set(recordKey, record);
    }
    if (record.status === "pending" && now > record.expiresAt) record.status = "expired";
    return { status: record.status, expiresAt: record.expiresAt, legacy: true };
  }

  claim(input: unknown, userId: number, now = Date.now()): Inspection {
    const inspection = this.inspect(input, userId, now);
    if (inspection.status !== "pending") return inspection;
    const ticket = parseTicketQuery(input);
    if (!ticket) return { status: "invalid", legacy: inspection.legacy };
    const records = inspection.legacy ? this.legacyRecords : this.records;
    const record = records.get(keyFor(ticket, userId));
    if (!record || record.status !== "pending") {
      return { status: record?.status ?? "invalid", expiresAt: record?.expiresAt, legacy: inspection.legacy };
    }
    record.status = "processing";
    return { status: "processing", expiresAt: record.expiresAt, legacy: inspection.legacy, claimed: true };
  }

  finish(input: unknown, userId: number, status: Exclude<VerificationStatus, "pending" | "processing">, legacy: boolean): void {
    this.update(input, userId, legacy, "processing", status);
  }

  release(input: unknown, userId: number, legacy: boolean): void {
    this.update(input, userId, legacy, "processing", "pending");
  }

  hasActiveRequest(chatId: number, userId: number, now = Date.now()): boolean {
    for (const record of this.records.values()) {
      if (record.chatId === chatId && record.userId === userId &&
          (record.status === "pending" || record.status === "processing") && record.expiresAt >= now) return true;
    }
    return false;
  }

  private update(input: unknown, userId: number, legacy: boolean, expected: VerificationStatus, next: VerificationStatus): void {
    const ticket = parseTicketQuery(input);
    if (!ticket) return;
    const records = legacy ? this.legacyRecords : this.records;
    const record = records.get(keyFor(ticket, userId));
    if (record?.status === expected) record.status = next;
  }

  private signV1(ticket: { chatId: number; messageId: number; userId: number; privateChatId: number; timestamp: number; nonce: string }): string {
    const payload = `v1:${ticket.chatId}:${ticket.messageId}:${ticket.userId}:${ticket.privateChatId}:${ticket.timestamp}:${ticket.nonce}`;
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  private signLegacy(ticket: NormalizedTicket & { userId: number }): string {
    const payload = `${ticket.messageId}, ${ticket.chatId}, ${ticket.userId}, ${ticket.timestamp}`;
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  private prune(now: number): void {
    for (const [key, record] of this.records) {
      if (now > record.expiresAt + 24 * 60 * 60 * 1000) this.records.delete(key);
      else if (record.status === "pending" && now > record.expiresAt) record.status = "expired";
    }
    for (const [key, record] of this.legacyRecords) {
      if (now > record.expiresAt + 24 * 60 * 60 * 1000) this.legacyRecords.delete(key);
      else if (record.status === "pending" && now > record.expiresAt) record.status = "expired";
    }
    if (this.records.size + this.legacyRecords.size > 20_000) {
      for (const [key, record] of this.records) if (record.status !== "processing") this.records.delete(key);
      for (const [key, record] of this.legacyRecords) if (record.status !== "processing") this.legacyRecords.delete(key);
    }
  }
}
