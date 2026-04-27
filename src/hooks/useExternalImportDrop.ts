import { useCallback, useRef, useState } from "react";
import type { BinaryImageImportItem } from "@/stores/fileTypes";

function isExternalFileDrag(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

function getDroppedPaths(e: React.DragEvent) {
  return Array.from(e.dataTransfer.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => Boolean(path));
}

function getDropTargetFolderId(e: React.DragEvent) {
  const target = e.target;
  if (!(target instanceof Element)) {
    return undefined;
  }

  const folderElement = target.closest("[data-folder-id]");
  if (!folderElement) {
    return undefined;
  }

  const folderId = folderElement.getAttribute("data-folder-id");
  if (!folderId) {
    return undefined;
  }

  const parsed = Number(folderId);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getFileExt(file: File) {
  const nameParts = file.name.split(".");
  const extFromName = nameParts.length > 1 ? nameParts.pop() : undefined;
  if (extFromName) {
    return extFromName.toLowerCase();
  }

  const mimePart = file.type.split("/")[1];
  return mimePart ? mimePart.toLowerCase() : "png";
}

async function fileToImportItem(file: File): Promise<BinaryImageImportItem> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    ext: getFileExt(file),
  };
}

export function useExternalImportDrop({
  dragOverFolderId,
  importBinaryImages,
  importFiles,
  isDraggingInternal,
  setDragOverFolderId,
}: {
  dragOverFolderId: number | null;
  importBinaryImages: (
    items: BinaryImageImportItem[],
    targetFolderId?: number | null,
  ) => Promise<unknown>;
  importFiles: (sourcePaths: string[], targetFolderId?: number | null) => Promise<unknown>;
  isDraggingInternal: boolean;
  setDragOverFolderId: (folderId: number | null) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const dragOverFolderIdRef = useRef<number | null>(dragOverFolderId);
  dragOverFolderIdRef.current = dragOverFolderId;

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (!isDraggingInternal && isExternalFileDrag(e)) {
        e.dataTransfer.dropEffect = "copy";
        dragCounterRef.current = 1;
        setIsDragging(true);
      }
    },
    [isDraggingInternal],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isDraggingInternal || !isExternalFileDrag(e)) {
        return;
      }

      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    },
    [isDraggingInternal],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isDraggingInternal || !isExternalFileDrag(e)) {
        return;
      }

      dragCounterRef.current += 1;
      setIsDragging(true);
    },
    [isDraggingInternal],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current = 0;
      setIsDragging(false);

      if (isDraggingInternal || !isExternalFileDrag(e)) {
        return;
      }

      const targetFolderId =
        getDropTargetFolderId(e) ??
        (dragOverFolderIdRef.current !== null ? dragOverFolderIdRef.current : undefined);
      const paths = getDroppedPaths(e);

      if (paths.length > 0) {
        void importFiles(paths, targetFolderId);
      } else {
        const items = await Promise.all(Array.from(e.dataTransfer.files).map(fileToImportItem));

        if (items.length > 0) {
          void importBinaryImages(items, targetFolderId);
        }
      }

      if (dragOverFolderIdRef.current !== null) {
        setDragOverFolderId(null);
      }
    },
    [importBinaryImages, importFiles, isDraggingInternal, setDragOverFolderId],
  );

  return {
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDragging,
    setIsDragging,
  };
}
