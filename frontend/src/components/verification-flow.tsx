"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Info,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  UserRound
} from "lucide-react";
import { toast } from "sonner";
import { CaptchaChallenge } from "@/components/captcha-challenge";
import { TelegramLogin } from "@/components/telegram-login";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
    case "CAPTCHA_ERROR": return "The security check is temporarily unavailable. Please try again.";
    case "TELEGRAM_API_UNAVAILABLE": return "Telegram could not be reached just now. Your request is still active; please retry.";
    case "USER_ID_MISMATCH": return "This Telegram account does not match the group join request.";
    case "TELEGRAM_ACCOUNT_INFO_ERROR":
    case "TELEGRAM_LOGIN_INVALID": return "Telegram could not confirm this account. Reopen the link from your join request.";
    case "INVALID_REQUEST": return "This verification link is invalid. Ask the group to send you a new one.";
    default: return "We couldn't reach the verification service. Check your connection and try again.";
  }
}

function StatusIcon({ state }: { state: VerificationViewState }) {
  if (state === "loading") return <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />;
  if (state === "success" || state === "already_verified") return <CheckCircle2 className="size-5" aria-hidden="true" />;
  if (state === "expired") return <Clock3 className="size-5" aria-hidden="true" />;
  if (state === "rejected" || state === "error") return <CircleAlert className="size-5" aria-hidden="true" />;
  return <ShieldCheck className="size-5" aria-hidden="true" />;
}

function Steps({ activeStep, done }: { activeStep: number; done: boolean }) {
  const steps = [
    { icon: UserRound, title: "Confirm your Telegram account", note: "Match the account that requested to join." },
    { icon: ShieldCheck, title: "Complete the security check", note: "A quick challenge helps keep the group safe." },
    { icon: Check, title: "Return to your group", note: "The bot sends the approval to Telegram." }
  ];

  return (
    <ol className="mt-5 space-y-0">
      {steps.map(({ icon: Icon, title, note }, index) => {
        const complete = done || index < activeStep;
        const active = !done && index === activeStep;
        return (
          <li key={title} className="relative flex gap-3 pb-5 last:pb-0">
            {index < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-4 top-8 w-px bg-border" />}
            <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full border ${complete ? "border-primary bg-primary text-primary-foreground" : active ? "border-primary/35 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}>
              {complete ? <Check className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={`block text-sm font-medium leading-5 ${active || complete ? "text-foreground" : "text-muted-foreground"}`}>{title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
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
    if (remaining === undefined || state !== "captcha" || remaining <= 0) return;
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
    toast.error("The security check could not load. Check your connection and reload this page.");
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
      } else if (next === "captcha" || next === "error" || next === "rejected") {
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
    waiting: fallback
      ? { title: "Confirm this Telegram account", detail: "Sign in with the account that sent the group join request." }
      : { title: "Open Telegram to continue", detail: "This private link belongs to a Telegram group join request." },
    loading: { title: "Checking your request", detail: "We’re confirming that this private link is valid." },
    captcha: { title: "Complete one security check", detail: "Confirm your account and pass the challenge to send your approval to Telegram." },
    success: { title: "Your request is approved", detail: "You can return to Telegram and continue to the group." },
    already_verified: { title: "You’re already verified", detail: "This join request has already been approved. Return to Telegram to continue." },
    expired: { title: "This link has expired", detail: "Verification links are short-lived to protect your join request." },
    rejected: { title: "The check didn’t pass", detail: "This request was declined. You can start again with a new group join request." },
    error: { title: "We couldn’t check this link", detail: "The verification service didn’t return a result for this request." }
  }[viewState];

  const stateMeta = {
    waiting: { label: fallback ? "Account needed" : "Waiting", badge: "muted" as const, icon: "primary" },
    loading: { label: "Checking", badge: "default" as const, icon: "primary" },
    captcha: { label: "Action needed", badge: "default" as const, icon: "primary" },
    success: { label: "Approved", badge: "success" as const, icon: "success" },
    already_verified: { label: "Already approved", badge: "success" as const, icon: "success" },
    expired: { label: "Expired", badge: "destructive" as const, icon: "danger" },
    rejected: { label: "Declined", badge: "destructive" as const, icon: "danger" },
    error: { label: "Link problem", badge: "destructive" as const, icon: "danger" }
  }[viewState];

  const activeStep = viewState === "captcha" ? 1 : viewState === "success" || viewState === "already_verified" ? 2 : ["expired", "rejected", "error"].includes(viewState) ? -1 : 0;
  const flowDone = viewState === "success" || viewState === "already_verified";

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8 lg:px-10">
        <header className="flex h-[4.5rem] shrink-0 items-center justify-between border-b border-border/80">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-[-0.02em]">Telegram Watchdog</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Group entry check</span>
            </span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />
            <span>Private link</span>
          </div>
        </header>

        <main className="grid flex-1 content-center gap-8 py-8 sm:py-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(410px,1fr)] lg:items-center lg:gap-16 lg:py-14">
          <section aria-labelledby="welcome-title" className="min-w-0 lg:pb-4">
            <p className="mb-4 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary sm:mb-5">
              <span aria-hidden="true" className="h-px w-7 bg-primary" />
              Entry check / Telegram
            </p>
            <h1 id="welcome-title" className="max-w-[12ch] text-[2.65rem] font-semibold leading-[1.02] tracking-[-0.055em] text-foreground sm:text-5xl lg:text-[3.4rem]">
              One quick check.<br />Then you’re in.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-muted-foreground sm:mt-5 sm:text-base">
              Confirm your Telegram account and complete the security check. The bot will approve your join request when it passes.
            </p>

            <div className="mt-6 flex items-center gap-2 text-xs leading-5 text-muted-foreground lg:hidden">
              <LockKeyhole className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>Private to this request</span><span aria-hidden="true">·</span><span>Single-use link</span>
            </div>

            <div className="mt-9 hidden max-w-sm border-t border-border pt-6 lg:block">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">What happens next</p>
              <Steps activeStep={activeStep} done={flowDone} />
              <p className="mt-6 flex items-start gap-2 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                This link is private to your request and can only be used once.
              </p>
            </div>
          </section>

          <Card className="w-full overflow-hidden rounded-[1.6rem] border-border bg-card shadow-[0_24px_70px_-48px_rgba(22,73,105,0.48)]">
            <CardHeader className="gap-5 border-b border-border p-5 sm:p-7">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                  Join request
                </span>
                <Badge variant={stateMeta.badge} className="shrink-0 px-2.5 py-1 text-[11px]">
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${stateMeta.icon === "success" ? "bg-emerald-500" : stateMeta.icon === "danger" ? "bg-destructive" : "bg-primary"}`} />
                  {stateMeta.label}
                </Badge>
              </div>
              <div className="flex items-start gap-3.5">
                <span className={`mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl ${stateMeta.icon === "success" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : stateMeta.icon === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                  <StatusIcon state={viewState} />
                </span>
                <div className="min-w-0 space-y-2">
                  <CardTitle id="verification-title" className="text-[1.35rem] leading-7 tracking-[-0.035em] sm:text-2xl">{copy.title}</CardTitle>
                  <CardDescription className="max-w-md text-sm leading-6">{copy.detail}</CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-5 sm:p-7">
              {viewState === "loading" && (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/55 p-4" role="status" aria-live="polite">
                  <LoaderCircle className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-5">Checking securely</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">This usually takes just a moment.</p>
                  </div>
                </div>
              )}

              {viewState === "captcha" && (
                <div className="space-y-3.5">
                  <p className="text-sm font-medium leading-5">Complete the challenge to continue</p>
                  <CaptchaChallenge onVerify={handleCaptcha} onError={handleCaptchaError} />
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg bg-muted/55 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                    <span className="flex min-w-0 items-start gap-2"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" /><span>Your result is checked securely by the bot.</span></span>
                    {remaining !== undefined && <span className="whitespace-nowrap text-right tabular-nums" aria-live="polite">Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>}
                  </div>
                </div>
              )}

              {viewState === "waiting" && (fallback ? (
                <div className="space-y-4">
                  <Alert>
                    <UserRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0"><AlertTitle>Use the account that requested to join</AlertTitle><AlertDescription>Telegram will confirm your identity before the check starts.</AlertDescription></div>
                  </Alert>
                  <div className="flex min-h-14 items-center justify-center rounded-xl border border-dashed border-border bg-background px-4 py-3">
                    <TelegramLogin botUsername={telegramBot} onAuth={handleLogin} />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert>
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0"><AlertTitle>Continue from the bot’s message</AlertTitle><AlertDescription>Open its verification button in Telegram, or use the browser check here.</AlertDescription></div>
                  </Alert>
                  <Button className="w-full justify-between" onClick={() => { if (fallbackUrl) window.location.assign(fallbackUrl); }}>
                    <span>Continue in browser</span><ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}

              {(viewState === "success" || viewState === "already_verified") && (
                <Alert variant="success">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                  <div className="min-w-0"><AlertTitle>{viewState === "success" ? "Join request approved" : "Access is already approved"}</AlertTitle><AlertDescription>Return to Telegram to continue to the group.</AlertDescription></div>
                </Alert>
              )}

              {viewState === "expired" && (
                <Alert variant="destructive">
                  <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0"><AlertTitle>Start a fresh request</AlertTitle><AlertDescription>Return to the group and request to join again. The bot will send a new verification link.</AlertDescription></div>
                </Alert>
              )}

              {viewState === "rejected" && (
                <Alert variant="destructive" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0"><AlertTitle>Request declined</AlertTitle><AlertDescription>Submit a new join request in the group if you’d like to try again.</AlertDescription></div>
                </Alert>
              )}

              {viewState === "error" && (
                <Alert variant="destructive" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0"><AlertTitle>Try again from Telegram</AlertTitle><AlertDescription>Open the verification button in your original message. If it still fails, ask the group to send a fresh request.</AlertDescription></div>
                </Alert>
              )}
            </CardContent>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5 sm:px-7">
              <span className="flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" /><span>Never asks for a password or login code</span></span>
              <Dialog>
                <DialogTrigger asChild><button type="button" className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Info className="size-3.5" aria-hidden="true" />How it works</button></DialogTrigger>
                <DialogContent>
                  <DialogTitle>A small check before you join</DialogTitle>
                  <DialogDescription>The bot confirms the Telegram account and security challenge, then approves the matching join request.</DialogDescription>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    <p>Verification links expire quickly and can only be used once.</p>
                    <p>The app never asks for your Telegram password, phone number, or login code.</p>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </Card>
        </main>

        <footer className="flex min-h-12 items-center justify-between gap-4 border-t border-border/80 text-[11px] text-muted-foreground">
          <span>Protected by Telegram Watchdog</span>
          <span className="font-mono uppercase tracking-[0.1em]">Private · Single-use</span>
        </footer>
      </div>
    </div>
  );
}
