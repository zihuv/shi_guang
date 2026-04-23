import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary-600 text-white shadow-sm hover:bg-primary-700",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        outline:
          "border border-transparent bg-black/[0.035] text-gray-700 hover:bg-black/[0.055] dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]",
        secondary:
          "bg-black/[0.05] text-gray-700 hover:bg-black/[0.075] dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.09]",
        ghost: "text-gray-700 hover:bg-black/[0.045] dark:text-gray-300 dark:hover:bg-white/[0.06]",
        link: "text-primary-600 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[34px] px-3",
        sm: "h-8 rounded-[9px] px-2.5 text-[12px]",
        lg: "h-10 rounded-xl px-8",
        icon: "size-[34px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
