import { ChevronLeft, ChevronRight } from "lucide-react";

export function PanelResizeHandle({
  ariaLabel,
  isActive,
  onMouseDown,
}: {
  ariaLabel: string;
  isActive: boolean;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className="group relative z-10 flex flex-shrink-0 select-none"
      style={{ width: 0 }}
      onMouseDown={onMouseDown}
    >
      <div className="absolute -left-1 top-0 flex h-full w-2 cursor-col-resize items-stretch justify-center">
        <div
          className={`my-auto h-8 w-[2px] rounded-full transition-colors ${
            isActive
              ? "bg-blue-400/80 dark:bg-blue-500/80"
              : "bg-transparent group-hover:bg-black/10 dark:group-hover:bg-white/12"
          }`}
        />
      </div>
    </div>
  );
}

export function PanelEdgeToggle({
  ariaLabel,
  isCollapsed,
  offset,
  side,
  title,
  onClick,
}: {
  ariaLabel: string;
  isCollapsed: boolean;
  offset: number;
  side: "left" | "right";
  title: string;
  onClick: () => void;
}) {
  const Icon =
    side === "left"
      ? isCollapsed
        ? ChevronRight
        : ChevronLeft
      : isCollapsed
        ? ChevronLeft
        : ChevronRight;
  const inset = isCollapsed ? 4 : Math.max(4, offset - 10);
  const style = side === "left" ? { left: inset } : { right: inset };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={!isCollapsed}
      title={title}
      className="absolute top-1/2 z-30 flex h-9 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--app-surface)]/45 text-gray-400 opacity-45 shadow-[0_4px_12px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.03] backdrop-blur-sm transition-[background-color,color,opacity,box-shadow] hover:bg-[var(--app-surface-strong)]/95 hover:text-gray-700 hover:opacity-100 hover:shadow-[0_8px_18px_rgba(15,23,42,0.12)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-500 dark:ring-white/[0.04] dark:hover:text-gray-200"
      style={style}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
