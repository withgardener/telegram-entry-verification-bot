import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type AuthFields = Record<string, string | number>;

function equalHash(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function isFresh(authDate: number, nowSeconds: number, maxAgeSeconds: number): boolean {
  return Number.isSafeInteger(authDate) && authDate <= nowSeconds + 30 && nowSeconds - authDate <= maxAgeSeconds;
}

export function verifyWebAppInitData(data: AuthFields, botToken: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const { hash, ...fields } = data;
  if (!isFresh(Number(fields.auth_date), nowSeconds, 24 * 60 * 60)) return false;
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const checkString = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join("\n");
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return equalHash(expected, hash);
}

export interface TelegramLoginData {
  [key: string]: string | number | undefined;
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramLoginWidget(data: TelegramLoginData, botToken: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!isFresh(Number(data.auth_date), nowSeconds, 24 * 60 * 60)) return false;
  const { hash, ...fields } = data;
  const secretKey = createHash("sha256").update(botToken).digest();
  const checkString = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join("\n");
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return equalHash(expected, hash);
}
