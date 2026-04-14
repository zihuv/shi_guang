import * as React from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, disabled, onCheckedChange, onClick, ...props }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && !disabled) {
        onCheckedChange?.(!checked);
      }
    };

    return (
      <button
        {...props}
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-state={checked ? "checked" : "unchecked"}
        onClick={handleClick}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "border-primary-600 bg-primary-600"
            : "border-gray-300 bg-gray-200 dark:border-gray-600 dark:bg-dark-border",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    );
  },
);

Switch.displayName = "Switch";

export { Switch };
