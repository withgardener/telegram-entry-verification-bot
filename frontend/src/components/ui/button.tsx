import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:brightness-105 active:brightness-95",
        secondary: "bg-secondary text-secondary-foreground hover:brightness-95",
        ghost: "text-foreground hover:bg-muted",
        outline: "border bg-card text-card-foreground hover:bg-muted"
      },
      size: { default: "", sm: "min-h-9 rounded-lg px-3 text-xs", icon: "size-11 p-0" }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
