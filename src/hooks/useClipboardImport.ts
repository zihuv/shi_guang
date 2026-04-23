import { useCallback, useEffect } from "react";
import type { BinaryImageImportItem } from "@/stores/fileTypes";

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

export function useClipboardImport(
  importBinaryImages: (items: BinaryImageImportItem[]) => Promise<unknown>,
) {
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const importedItems = window.shiguang?.clipboard.readImportedImageItems();
      if (importedItems && importedItems.length > 0) {
        event.preventDefault();
        await importBinaryImages(importedItems);
        return;
      }

      const items = event.clipboardData?.items;
      if (!items) {
        const image = window.shiguang?.clipboard.readImageData();
        if (image) {
          event.preventDefault();
          await importBinaryImages([image]);
        }
        return;
      }

      const imageItems: BinaryImageImportItem[] = [];

      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }

        event.preventDefault();
        const blob = item.getAsFile();
        if (!blob) {
          continue;
        }

        const ext = blob.type.split("/")[1]?.replace(/\+.*/, "") || "png";
        imageItems.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          ext,
        });
      }

      if (imageItems.length > 0) {
        await importBinaryImages(imageItems);
        return;
      }

      const image = window.shiguang?.clipboard.readImageData();
      if (image) {
        event.preventDefault();
        await importBinaryImages([image]);
      }
    },
    [importBinaryImages],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);
}
