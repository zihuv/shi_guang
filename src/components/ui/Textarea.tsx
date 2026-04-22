import * as React from "react";

import { handlePrimaryClipboardShortcut, handlePrimarySelectAll } from "@/lib/textSelectionShortcuts";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onKeyDown, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "input-system-font flex min-h-[72px] w-full rounded-[10px] border border-gray-300/90 dark:border-gray-600 bg-white/70 px-3 py-2 text-[13px] text-gray-800 shadow-sm transition-[border-color,box-shadow,background-color] placeholder:text-gray-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 resize-none dark:bg-dark-bg/60 dark:text-gray-200 dark:focus:bg-dark-surface",
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
Textarea.displayName = "Textarea";

export { Textarea };
