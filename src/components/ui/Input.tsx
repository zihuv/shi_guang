import * as React from "react";

import {
  handlePrimaryClipboardShortcut,
  handlePrimarySelectAll,
} from "@/lib/textSelectionShortcuts";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, onKeyDown, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "input-system-font flex h-[34px] w-full rounded-[12px] border border-transparent bg-black/[0.035] px-3 text-[13px] text-gray-800 transition-[border-color,box-shadow,background-color,color] placeholder:text-gray-400 focus:border-primary-500/35 focus:bg-black/[0.05] focus:outline-none focus:ring-2 focus:ring-primary-500/18 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.05] dark:text-gray-200 dark:focus:border-primary-500/40 dark:focus:bg-white/[0.07]",
          className,
        )}
        ref={ref}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            return;
          }

          handlePrimarySelectAll(event);
          if (event.defaultPrevented) {
            return;
          }

          handlePrimaryClipboardShortcut(event);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
