import type { RequestQuery } from "@/lib/verification";

export type VerificationApiRequest =
  | { kind: "status"; request_query: RequestQuery }
  | { kind: "complete"; fallback: boolean; token: string; tglogin: unknown; request_query: RequestQuery };

type PreparedRequest = { url: string; init: RequestInit };

function backendEndpoint(input: VerificationApiRequest): string {
  if (input.kind === "status") return "/endpoints/verification/status";
  return input.fallback ? "/endpoints/verify-captcha-fallback" : "/endpoints/verify-captcha";
}

function backendBody(input: VerificationApiRequest): unknown {
  if (input.kind === "status") return { request_query: input.request_query };
  return { request_query: input.request_query, token: input.token, tglogin: input.tglogin };
}

function parseBackendOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("NEXT_PUBLIC_BACKEND_BASE_URL must be an absolute URL origin");
  }
  const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new TypeError("NEXT_PUBLIC_BACKEND_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return new URL(url.origin);
}

export function prepareVerificationRequest(input: VerificationApiRequest, publicBackendUrl = process.env.NEXT_PUBLIC_BACKEND_BASE_URL): PreparedRequest {
  const body = publicBackendUrl?.trim()
    ? JSON.stringify(backendBody(input))
    : JSON.stringify(input);
  const base: Omit<RequestInit, "body"> = {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    redirect: "error"
  };
  if (!publicBackendUrl?.trim()) return { url: "/api/verify", init: { ...base, body } };
  const origin = parseBackendOrigin(publicBackendUrl.trim());
  return { url: new URL(backendEndpoint(input), origin).toString(), init: { ...base, body } };
}

export function submitVerification(input: VerificationApiRequest): Promise<Response> {
  const request = prepareVerificationRequest(input);
  return fetch(request.url, request.init);
}
