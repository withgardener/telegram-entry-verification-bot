"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { VerificationFlow } from "@/components/verification-flow";

const acceptedKeys = ["chat_id", "msg_id", "user_id", "private_chat_id", "timestamp", "signature", "nonce", "fallback"] as const;

function QueryVerificationFlow() {
  const searchParams = useSearchParams();
  const query: Record<string, string> = {};
  for (const key of acceptedKeys) {
    const value = searchParams.get(key);
    if (value !== null && value.length <= 256) query[key] = value;
  }
  return <VerificationFlow query={query} />;
}

export function SearchParamVerification() {
  return (
    <Suspense fallback={(
      <main className="grid min-h-dvh place-items-center px-4 py-12">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Preparing your secure verification…</p>
      </main>
    )}>
      <QueryVerificationFlow />
    </Suspense>
  );
}
