import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutConfig,
} from "@/lib/shortcuts";
import ShortcutRecorder from "@/components/ShortcutRecorder";
import { Button } from "@/components/ui/Button";
import { SettingsRow, SettingsSectionBlock } from "./SettingsPrimitives";
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
    <SettingsSectionBlock title="快捷键">
      {SHORTCUT_ACTIONS.map((action) => (
        <SettingsRow key={action.id} title={action.label} className="sm:flex-row">
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
        </SettingsRow>
      ))}
    </SettingsSectionBlock>
  );
}
