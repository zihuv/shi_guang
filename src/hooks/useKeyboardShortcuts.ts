import { useEffect } from "react";
import { SHORTCUT_ACTIONS, matchShortcut, type ShortcutActionId } from "@/lib/shortcuts";
import { useFileStore } from "@/stores/fileStore";
import { useSettingsStore } from "@/stores/settingsStore";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function isDialogTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[role='dialog']"));
}

function canRunShortcut(actionId: ShortcutActionId) {
  const fileStore = useFileStore.getState();

  if (actionId === "undoDelete") {
    return fileStore.undoStack.length > 0;
  }

  if (actionId === "selectAllCurrentPageFiles") {
    return !fileStore.previewMode && fileStore.files.length > 0;
  }

  return true;
}

function runShortcut(actionId: ShortcutActionId) {
  if (actionId === "undoDelete") {
    void useFileStore.getState().undo();
    return;
  }

  if (actionId === "selectAllCurrentPageFiles") {
    useFileStore.getState().toggleSelectAll();
  }
}

export function useKeyboardShortcuts() {
  const shortcuts = useSettingsStore((state) => state.shortcuts);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return;
      }

      if (isEditableTarget(event.target) || isDialogTarget(event.target)) {
        return;
      }

      for (const action of SHORTCUT_ACTIONS) {
        const shortcut = shortcuts[action.id];
        if (!shortcut || !matchShortcut(event, shortcut)) {
          continue;
        }

        if (!canRunShortcut(action.id)) {
          return;
        }

        event.preventDefault();
        runShortcut(action.id);
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts]);
}
