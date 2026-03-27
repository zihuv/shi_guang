import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatShortcutDisplay, shortcutFromKeyboardEvent } from "@/lib/shortcuts";

interface ShortcutRecorderProps {
  shortcut: string;
  onChange: (shortcut: string) => Promise<void> | void;
}

export default function ShortcutRecorder({ shortcut, onChange }: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isRecording) {
      buttonRef.current?.focus();
    }
  }, [isRecording]);

  const handleKeyDown = async (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setIsRecording(false);
      return;
    }

    const nextShortcut = shortcutFromKeyboardEvent(event.nativeEvent);
    if (!nextShortcut) {
      return;
    }

    await onChange(nextShortcut);
    setIsRecording(false);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      data-shortcut-recorder="true"
      onClick={() => setIsRecording(true)}
      onKeyDown={handleKeyDown}
      onBlur={() => setIsRecording(false)}
      className={cn(
        "inline-flex min-w-[160px] items-center justify-start rounded-lg border px-3 py-2 text-left font-mono text-sm transition-colors",
        isRecording
          ? "border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-500/20 dark:bg-primary-900/20 dark:text-primary-200"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-dark-bg dark:text-gray-200 dark:hover:bg-dark-border",
      )}
    >
      {isRecording ? "按下新的组合键" : formatShortcutDisplay(shortcut)}
    </button>
  );
}
