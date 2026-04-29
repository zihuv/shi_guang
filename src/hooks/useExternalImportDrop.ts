import { useCallback, useRef, useState } from "react";
import { getDroppedFilePaths, isExternalFileDrag } from "@/utils/dropImport";

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

export function useExternalImportDrop({
  dragOverFolderId,
  importFiles,
  isDraggingInternal,
  setDragOverFolderId,
}: {
  dragOverFolderId: number | null;
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

      if (!isDraggingInternal && isExternalFileDrag(e.dataTransfer)) {
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

      if (isDraggingInternal || !isExternalFileDrag(e.dataTransfer)) {
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

      if (isDraggingInternal || !isExternalFileDrag(e.dataTransfer)) {
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

      if (isDraggingInternal || !isExternalFileDrag(e.dataTransfer)) {
        return;
      }

      const targetFolderId =
        getDropTargetFolderId(e) ??
        (dragOverFolderIdRef.current !== null ? dragOverFolderIdRef.current : undefined);
      const paths = getDroppedFilePaths(e.dataTransfer);

      if (paths.length > 0) {
        void importFiles(paths, targetFolderId);
      }

      if (dragOverFolderIdRef.current !== null) {
        setDragOverFolderId(null);
      }
    },
    [importFiles, isDraggingInternal, setDragOverFolderId],
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
