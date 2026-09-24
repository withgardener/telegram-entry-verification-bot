export {};

declare global {
  interface TelegramLoginUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
  }

  interface TelegramWebApp {
    initData: string;
    ready(): void;
    expand(): void;
    close(): void;
    HapticFeedback?: { notificationOccurred(type: "success" | "error" | "warning"): void };
    MainButton?: TelegramMainButton;
  }

  interface TelegramMainButton {
    show(): TelegramMainButton;
    setParams(params: { text: string }): TelegramMainButton;
    onClick(callback: () => void): void;
  }

  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    turnstile?: {
      render(container: HTMLElement, options: {
        sitekey: string;
        action: string;
        theme: "auto";
        callback(token: string): void;
        "error-callback"(): void;
        "expired-callback"(): void;
      }): string;
      remove(widgetId: string): void;
      reset(widgetId?: string): void;
    };
    onTelegramAuth?: (user: TelegramLoginUser) => void;
  }
}
