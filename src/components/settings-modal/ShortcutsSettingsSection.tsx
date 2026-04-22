import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutConfig,
} from "@/lib/shortcuts";
import ShortcutRecorder from "@/components/ShortcutRecorder";
import { Button } from "@/components/ui/Button";
import { RotateCcw } from "lucide-react";

interface ShortcutsSettingsSectionProps {
  shortcuts: ShortcutConfig;
  onShortcutChange: (actionId: ShortcutActionId, nextShortcut: string) => void;
  onShortcutClear: (actionId: ShortcutActionId) => void;
  onShortcutReset: (actionId: ShortcutActionId) => void;
}

export function ShortcutsSettingsSection({
  shortcuts,
  onShortcutChange,
  onShortcutClear,
  onShortcutReset,
}: ShortcutsSettingsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">快捷键</h3>

      <div className="flex flex-col gap-4">
        {SHORTCUT_ACTIONS.map((action) => (
          <div
            key={action.id}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{action.label}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ShortcutRecorder
                shortcut={shortcuts[action.id]}
                onChange={(nextShortcut) => onShortcutChange(action.id, nextShortcut)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onShortcutClear(action.id)}
                disabled={!shortcuts[action.id]}
              >
                清空
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onShortcutReset(action.id)}
                disabled={shortcuts[action.id] === DEFAULT_SHORTCUTS[action.id]}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                默认
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
