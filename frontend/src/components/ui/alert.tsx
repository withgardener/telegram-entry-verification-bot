import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const alertStyles = cva("relative w-full rounded-2xl border p-4 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-muted/55 text-foreground",
      destructive: "border-destructive/25 bg-destructive/8 text-destructive",
      success: "border-emerald-500/25 bg-emerald-500/8 text-emerald-800 dark:text-emerald-200"
    }
  },
  defaultVariants: { variant: "default" }
});

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertStyles> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="status" className={cn(alertStyles({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("mb-1 font-semibold leading-none", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("leading-6 opacity-90", className)} {...props} />;
}
