import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionBlockProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function SettingsSectionBlock({ title, children, className }: SettingsSectionBlockProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <h3 className="px-1 text-[13px] font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  title: string;
  children: ReactNode;
  detail?: ReactNode;
  className?: string;
}

export function SettingsRow({ title, detail, children, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.035] md:flex-row md:items-center md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">{title}</p>
        {detail ? (
          <div className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-gray-400">
            {detail}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

interface StatusPillProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
  className?: string;
}

export function StatusPill({ children, tone = "neutral", className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium leading-none",
        tone === "success" &&
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
        tone === "warning" && "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
        tone === "neutral" &&
          "bg-black/[0.045] text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
        className,
      )}
    >
      {children}
    </span>
  );
}
