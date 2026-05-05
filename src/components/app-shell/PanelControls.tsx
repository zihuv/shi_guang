import { PanelLeftOpen } from "lucide-react";

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

export function PanelRestoreToggle({
  ariaLabel,
  title,
  onClick,
}: {
  ariaLabel: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <div className="flex h-full w-10 flex-shrink-0 justify-center pt-1.5">
      <button
        type="button"
        aria-label={ariaLabel}
        title={title}
        className="inline-flex size-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-black/[0.045] hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
        onClick={onClick}
      >
        <PanelLeftOpen className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
