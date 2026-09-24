"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Info,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRoundCheck
} from "lucide-react";
import { toast } from "sonner";
import { CaptchaChallenge } from "@/components/captcha-challenge";
import { TelegramLogin } from "@/components/telegram-login";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { submitVerification } from "@/lib/verification-api";
import { apiStateToViewState, readRequestQuery, type RequestQuery, type VerificationViewState } from "@/lib/verification";

type TelegramIdentity = { mode: "webapp"; data: Record<string, string> } | { mode: "fallback"; data: TelegramLoginUser };
type ApiResponse = { status?: string; message?: string; expires_in?: number };

function readBody(value: unknown): ApiResponse {
  if (typeof value !== "object" || value === null) return {};
  const body = value as Record<string, unknown>;
  return {
    status: typeof body.status === "string" ? body.status : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    expires_in: typeof body.expires_in === "number" ? body.expires_in : undefined
  };
}

function friendlyError(message: string | undefined): string {
  switch (message) {
    case "CAPTCHA_ERROR": return "The secure check is temporarily unavailable. Please try again.";
    case "TELEGRAM_API_UNAVAILABLE": return "Telegram could not be reached just now. Your request is still active; please retry.";
    case "USER_ID_MISMATCH": return "This Telegram account does not match the group join request.";
    case "TELEGRAM_ACCOUNT_INFO_ERROR":
    case "TELEGRAM_LOGIN_INVALID": return "Telegram could not confirm this account. Reopen the link from your join request.";
    case "INVALID_REQUEST": return "This verification link is invalid. Ask the group to send you a new one.";
    default: return "We couldn't finish verification. Please reopen the request in Telegram or try again.";
  }
}

function StatusIcon({ state }: { state: VerificationViewState }) {
  if (state === "loading") return <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />;
  if (state === "success" || state === "already_verified") return <CheckCircle2 className="size-6" aria-hidden="true" />;
  if (state === "expired") return <Clock3 className="size-6" aria-hidden="true" />;
  if (state === "rejected" || state === "error") return <AlertCircle className="size-6" aria-hidden="true" />;
  return <ShieldCheck className="size-6" aria-hidden="true" />;
}

export function VerificationFlow({ query }: { query: Record<string, string> }) {
  const serializedQuery = JSON.stringify(query);
  const requestQuery = useMemo<RequestQuery | undefined>(() => {
    const entries = JSON.parse(serializedQuery) as Record<string, string>;
    return readRequestQuery(new URLSearchParams(entries));
  }, [serializedQuery]);
  const [state, setState] = useState<VerificationViewState>("loading");
  const [identity, setIdentity] = useState<TelegramIdentity>();
  const [fallback, setFallback] = useState(false);
  const [remaining, setRemaining] = useState<number>();

  const inspectTicket = useCallback(async (): Promise<{ response: Response; body: ApiResponse }> => {
    if (!requestQuery) throw new Error("INVALID_REQUEST");
    const response = await submitVerification({ kind: "status", request_query: requestQuery });
    return { response, body: readBody(await response.json().catch(() => ({}))) };
  }, [requestQuery]);

  useEffect(() => {
    let active = true;
    const initialize = async (): Promise<void> => {
      if (!requestQuery) {
        setState("error");
        return;
      }
      try {
        const { response, body } = await inspectTicket();
        if (!active) return;
        const ticketState = apiStateToViewState(response.status, body.message, body.status);
        if (ticketState !== "captcha") {
          setState(ticketState);
          if (ticketState === "error") toast.error(friendlyError(body.message));
          return;
        }
        setRemaining(body.expires_in);
        const isFallback = requestQuery.fallback === "1";
        setFallback(isFallback);
        if (isFallback) {
          setState("waiting");
          return;
        }
        const webApp = window.Telegram?.WebApp;
        if (!webApp?.initData) {
          setState("waiting");
          return;
        }
        webApp.ready();
        webApp.expand();
        const data: Record<string, string> = {};
        for (const [key, value] of new URLSearchParams(webApp.initData)) data[key] = value;
        const user = JSON.parse(data.user ?? "{}") as { id?: unknown };
        if (typeof user.id !== "number" || String(user.id) !== requestQuery.user_id) {
          setState("rejected");
          return;
        }
        setIdentity({ mode: "webapp", data });
        setState("captcha");
      } catch {
        if (active) {
          setState("error");
          toast.error(friendlyError(undefined));
        }
      }
    };
    void initialize();
    return () => { active = false; };
  }, [inspectTicket, requestQuery]);

  useEffect(() => {
    if (remaining === undefined || state !== "captcha") return;
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((current) => current === undefined ? current : current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining, state]);

  const handleLogin = useCallback((user: TelegramLoginUser): void => {
    if (!requestQuery || String(user.id) !== requestQuery.user_id) {
      setState("rejected");
      return;
    }
    setIdentity({ mode: "fallback", data: user });
    setState("captcha");
  }, [requestQuery]);

  const handleCaptchaError = useCallback((): void => {
    toast.error("The secure check could not load. Check your connection and reload this page.");
  }, []);

  const handleCaptcha = useCallback(async (challengeToken: string): Promise<void> => {
    if (!requestQuery || !identity) return;
    setState("loading");
    try {
      const response = await submitVerification({
        kind: "complete",
        fallback: identity.mode === "fallback",
        token: challengeToken,
        tglogin: identity.data,
        request_query: requestQuery
      });
      const body = readBody(await response.json().catch(() => ({})));
      const next = apiStateToViewState(response.status, body.message, body.status);
      setState(next);
      if (next === "success" || next === "already_verified") {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
        const mainButton = window.Telegram?.WebApp?.MainButton;
        if (identity.mode === "webapp" && mainButton) {
          mainButton.show().setParams({ text: "Done" }).onClick(() => window.Telegram?.WebApp?.close());
        }
      } else if (next === "captcha") {
        toast.error(friendlyError(body.message));
      } else if (next === "error" || next === "rejected") {
        toast.error(friendlyError(body.message));
      }
    } catch {
      setState("captcha");
      toast.error(friendlyError("API_UNAVAILABLE"));
    }
  }, [identity, requestQuery]);

  const telegramBot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";
  const fallbackUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.searchParams.set("fallback", "1");
    return url.toString();
  }, []);

  const viewState: VerificationViewState = state === "captcha" && remaining !== undefined && remaining <= 0 ? "expired" : state;
  const copy = {
    waiting: { title: fallback ? "Confirm your Telegram account" : "Open this in Telegram", detail: fallback ? "Use the Telegram sign-in button to confirm that you sent this join request." : "This verification link was made for the Telegram app. You can also continue in your browser." },
    loading: { title: "Checking your request", detail: "Your request is being checked securely. This usually takes only a moment." },
    captcha: { title: "One quick security check", detail: "Complete the check below and we'll send your join approval to Telegram." },
    success: { title: "You're approved", detail: "Your group join request has been approved. You can return to Telegram now." },
    already_verified: { title: "Already verified", detail: "This join request has already been approved. Return to Telegram to continue." },
    expired: { title: "This link has expired", detail: "For your security, verification links work for a short time. Ask the group to send a fresh join request." },
    rejected: { title: "Verification didn't pass", detail: "The join request was declined. Start a new request with the group to try again." },
    error: { title: "We couldn't verify this link", detail: "Reopen the verification button in your Telegram message, or ask the group to send a new request." }
  }[viewState];

  const badgeVariant = viewState === "success" || viewState === "already_verified" ? "success" : viewState === "expired" || viewState === "rejected" || viewState === "error" ? "destructive" : "default";
  const badgeLabel = viewState === "success" ? "Approved" : viewState === "already_verified" ? "Already approved" : viewState === "expired" ? "Expired" : viewState === "rejected" ? "Not approved" : viewState === "error" ? "Link problem" : viewState === "loading" ? "Checking" : viewState === "waiting" ? "Waiting" : "Verification";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
      <header className="flex items-center justify-between gap-4 pb-8">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm"><ShieldCheck className="size-6" aria-hidden="true" /></div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Entry verification</p>
            <p className="text-xs text-muted-foreground">Telegram group access</p>
          </div>
        </div>
        <Badge variant="muted"><LockKeyhole className="size-3.5" aria-hidden="true" />Private check</Badge>
      </header>

      <main className="flex flex-1 flex-col justify-center pb-8">
        <Card className="overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-sky-400 via-primary to-indigo-400" />
          <CardHeader className="items-center text-center">
            <div className={`mb-2 grid size-16 place-items-center rounded-[1.35rem] ${viewState === "success" || viewState === "already_verified" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : viewState === "expired" || viewState === "rejected" || viewState === "error" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
              <StatusIcon state={viewState} />
            </div>
            <Badge variant={badgeVariant}><span className={`size-1.5 rounded-full ${viewState === "success" || viewState === "already_verified" ? "bg-emerald-500" : viewState === "expired" || viewState === "rejected" || viewState === "error" ? "bg-destructive" : "bg-primary"}`} />{badgeLabel}</Badge>
            <CardTitle className="pt-1 text-[1.45rem] sm:text-2xl">{copy.title}</CardTitle>
            <CardDescription className="max-w-sm">{copy.detail}</CardDescription>
          </CardHeader>

          <CardContent>
            {viewState === "loading" && (
              <div className="space-y-3 rounded-2xl border bg-background/70 p-4" aria-live="polite">
                <div className="flex items-center justify-between text-sm"><span className="font-medium">Finishing securely</span><span className="text-muted-foreground">Please wait</span></div>
                <Progress value={72} aria-label="Verification progress" />
              </div>
            )}

            {viewState === "captcha" && (
              <div className="space-y-4">
                <CaptchaChallenge onVerify={handleCaptcha} onError={handleCaptchaError} />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><LockKeyhole className="size-3.5" aria-hidden="true" />Your check is validated by the server.</span>
                  {remaining !== undefined && <span aria-live="polite">Link expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}
                </div>
              </div>
            )}

            {viewState === "waiting" && (
              <div className="space-y-4">
                {fallback ? (
                  <div className="space-y-3 rounded-2xl border bg-background/70 p-4 text-center">
                    <UserRoundCheck className="mx-auto size-5 text-primary" aria-hidden="true" />
                    <p className="text-sm font-medium">Sign in with the same Telegram account</p>
                    <TelegramLogin botUsername={telegramBot} onAuth={handleLogin} />
                  </div>
                ) : (
                  <>
                    <Alert>
                      <AlertTitle>Continue where your request started</AlertTitle>
                      <AlertDescription>Open this message in Telegram to use its secure in-app identity, or continue with browser verification below.</AlertDescription>
                    </Alert>
                    <Button className="w-full" onClick={() => { if (fallbackUrl) window.location.assign(fallbackUrl); }}>
                      Continue in browser <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            )}

            {(viewState === "success" || viewState === "already_verified") && (
              <Alert variant="success">
                <div className="flex items-start gap-3"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><div><AlertTitle>You&apos;re all set</AlertTitle><AlertDescription>The bot has recorded the result. If Telegram is still showing the group request, return to the chat and refresh.</AlertDescription></div></div>
              </Alert>
            )}

            {(viewState === "expired" || viewState === "rejected" || viewState === "error") && (
              <Alert variant={viewState === "error" ? "default" : "destructive"}>
                <AlertTitle>{viewState === "expired" ? "A new request is needed" : viewState === "rejected" ? "No group access was granted" : "Check the Telegram message"}</AlertTitle>
                <AlertDescription>{viewState === "error" ? friendlyError(undefined) : "The bot can issue a fresh link when you request to join again."}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          <span>Fast, private, and only for this join request</span>
          <Dialog>
            <DialogTrigger asChild><button type="button" className="ml-1 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-medium text-primary hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="size-3.5" aria-hidden="true" />How it works</button></DialogTrigger>
            <DialogContent>
              <DialogTitle>A small check before you join</DialogTitle>
              <DialogDescription>The bot checks the Telegram identity and the security challenge on its server, then approves the matching join request.</DialogDescription>
              <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>Verification tickets expire quickly and can be used once. A short-lived in-memory record prevents the same result from being applied twice.</p>
                <p>The app does not ask for your phone number, password, or Telegram login code.</p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden="true" />Protected by Telegram Watchdog
      </footer>
    </div>
  );
}
