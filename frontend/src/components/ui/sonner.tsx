"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return <SonnerToaster theme="system" className="toaster group" toastOptions={{ classNames: { toast: "rounded-2xl border bg-card text-card-foreground shadow-lg", description: "text-muted-foreground" } }} {...props} />;
}
