"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

interface CaptchaChallengeProps {
  onVerify(token: string): void;
  onError(): void;
}

export function CaptchaChallenge({ onVerify, onError }: CaptchaChallengeProps) {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const verify = useCallback((token: string): void => onVerify(token), [onVerify]);
  const fail = useCallback((): void => onError(), [onError]);

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey || !container.current) {
      fail();
      return;
    }
    let widgetId: string | undefined;
    let active = true;
    const render = (): void => {
      if (!active || !container.current || !window.turnstile) return;
      setLoading(false);
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action: "telegram-verification",
        theme: "auto",
        callback: verify,
        "error-callback": fail,
        "expired-callback": fail
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = fail;
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [fail, verify]);

  return (
    <div className="relative flex min-h-[76px] items-center justify-center rounded-2xl border bg-background/70 p-4" aria-label="Human verification challenge">
      {loading && <span className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading secure check…</span>}
      <div ref={container} className="absolute inset-0 flex items-center justify-center" />
    </div>
  );
}
