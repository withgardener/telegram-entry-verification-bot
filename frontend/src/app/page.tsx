import { VerificationFlow } from "@/components/verification-flow";

type SearchParams = Record<string, string | string[] | undefined>;
const acceptedKeys = new Set(["chat_id", "msg_id", "user_id", "private_chat_id", "timestamp", "signature", "nonce", "fallback"]);

function sanitizeQuery(params: SearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!acceptedKeys.has(key) || typeof value !== "string" || value.length > 256) continue;
    result[key] = value;
  }
  return result;
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <VerificationFlow query={sanitizeQuery(await searchParams)} />;
}
