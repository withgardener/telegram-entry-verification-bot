"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const bounded = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root value={bounded} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <ProgressPrimitive.Indicator className="h-full w-full flex-1 bg-primary transition-transform duration-300" style={{ transform: `translateX(-${100 - bounded}%)` }} />
    </ProgressPrimitive.Root>
  );
}
