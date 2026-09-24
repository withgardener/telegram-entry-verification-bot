"use client";

import { useEffect, useRef } from "react";
export function TelegramLogin({ botUsername, onAuth }: { botUsername: string; onAuth(user: TelegramLoginUser): void }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = onAuth;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    container.current?.appendChild(script);
    return () => {
      window.onTelegramAuth = undefined;
      script.remove();
    };
  }, [botUsername, onAuth]);

  return <div ref={container} className="flex min-h-12 justify-center" aria-label="Sign in with Telegram" />;
}
