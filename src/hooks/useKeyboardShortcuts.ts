import { useEffect } from "react";
import { copyFilesToClipboard } from "@/lib/clipboard";
import { SHORTCUT_ACTIONS, matchShortcut, type ShortcutActionId } from "@/lib/shortcuts";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { useTrashStore } from "@/stores/trashStore";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"),
  );
}

function isDialogTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[role='dialog'], [role='menu']"));
}

function getCopyTargetFileIds() {
  const previewStore = usePreviewStore.getState();
  const selectionStore = useSelectionStore.getState();

  if (previewStore.previewMode) {
    const currentPreviewFile = previewStore.previewFiles[previewStore.previewIndex];
    return currentPreviewFile ? [currentPreviewFile.id] : [];
  }

  if (selectionStore.selectedFiles.length > 0) {
    return selectionStore.selectedFiles;
  }

  return selectionStore.selectedFile ? [selectionStore.selectedFile.id] : [];
}

function canRunShortcut(actionId: ShortcutActionId) {
  const previewStore = usePreviewStore.getState();
  const libraryStore = useLibraryQueryStore.getState();
  const navigationStore = useNavigationStore.getState();
  const trashStore = useTrashStore.getState();

  if (actionId === "copySelectedToClipboard") {
    return getCopyTargetFileIds().length > 0;
  }

  if (actionId === "undoDelete") {
    return trashStore.undoStack.length > 0;
  }

  if (actionId === "selectAllCurrentPageFiles") {
    return (
      navigationStore.currentView === "library" &&
      !previewStore.previewMode &&
      libraryStore.files.length > 0
    );
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
    void useTrashStore.getState().undo();
    return;
  }

  if (actionId === "selectAllCurrentPageFiles") {
    useSelectionStore.getState().toggleSelectAll();
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
