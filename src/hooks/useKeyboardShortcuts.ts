import { useEffect } from "react";
import { copyFilesToClipboard } from "@/lib/clipboard";
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
  return target instanceof HTMLElement && Boolean(target.closest("[role='dialog'], [role='menu']"));
}

function getCopyTargetFileIds() {
  const fileStore = useFileStore.getState();

  if (fileStore.previewMode) {
    const currentPreviewFile = fileStore.previewFiles[fileStore.previewIndex];
    return currentPreviewFile ? [currentPreviewFile.id] : [];
  }

  if (fileStore.selectedFiles.length > 0) {
    return fileStore.selectedFiles;
  }

  return fileStore.selectedFile ? [fileStore.selectedFile.id] : [];
}

function canRunShortcut(actionId: ShortcutActionId) {
  const fileStore = useFileStore.getState();

  if (actionId === "copySelectedToClipboard") {
    return getCopyTargetFileIds().length > 0;
  }

  if (actionId === "undoDelete") {
    return fileStore.undoStack.length > 0;
  }

  if (actionId === "selectAllCurrentPageFiles") {
    return !fileStore.previewMode && fileStore.files.length > 0;
  }

  return true;
}

async function runShortcut(actionId: ShortcutActionId) {
  if (actionId === "copySelectedToClipboard") {
    const fileIds = getCopyTargetFileIds();
    if (fileIds.length === 0) {
      return;
    }

    try {
      await copyFilesToClipboard(fileIds);
    } catch (error) {
      console.error("Failed to copy files to clipboard:", error);
    }
    return;
  }

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
        void runShortcut(action.id);
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts]);
}
