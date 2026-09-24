import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeStyles = cva("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-primary/20 bg-primary/10 text-primary",
      muted: "border-border bg-muted text-muted-foreground",
      success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      destructive: "border-destructive/20 bg-destructive/10 text-destructive"
    }
  },
  defaultVariants: { variant: "default" }
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant }), className)} {...props} />;
}
