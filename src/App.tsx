import { useCallback, useRef, useState } from "react";
import { Toaster } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";
import { useFolderStore } from "@/stores/folderStore";
import { useFilterStore } from "@/stores/filterStore";
import Header from "@/components/Header";
import SidePanel from "@/components/SidePanel";
import FileGrid from "@/components/FileGrid";
import DetailPanel from "@/components/DetailPanel";
import SettingsModal from "@/components/SettingsModal";
import ImagePreview from "@/components/ImagePreview";
import FilterPanel from "@/components/FilterPanel";
import DragPreview from "@/components/DragPreview";
import { useAppInitialization } from "@/hooks/useAppInitialization";
import { useClipboardImport } from "@/hooks/useClipboardImport";
import { useDocumentTheme } from "@/hooks/useDocumentTheme";
import { useInternalFileDrag } from "@/hooks/useInternalFileDrag";
import { useTauriImportListeners } from "@/hooks/useTauriImportListeners";
import { useUndoHotkey } from "@/hooks/useUndoHotkey";

function App() {
  const { theme } = useSettingsStore();

  const {
    importImagesFromBase64,
    importFile: importFileFn,
    previewMode,
    files,
  } = useFileStore();
  const { dragOverFolderId, setDragOverFolderId } = useFolderStore();
  const { isFilterPanelOpen } = useFilterStore();
  const { isDraggingInternal } = useFileStore();
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null);
  const dragCounterRef = useRef(0);
  const dragOverFolderIdRef = useRef<number | null>(dragOverFolderId);

  dragOverFolderIdRef.current = dragOverFolderId;

  useAppInitialization();
  useInternalFileDrag(setDraggingFileId);
  useTauriImportListeners({
    dragOverFolderId,
    setDragOverFolderId,
    setIsDragging,
    importFile: importFileFn,
  });
  useClipboardImport(importImagesFromBase64);
  useDocumentTheme(theme);
  useUndoHotkey();

  const isExternalFileDrag = useCallback((e: React.DragEvent) => {
    return Array.from(e.dataTransfer.types).includes("Files");
  }, []);

  const getDroppedPaths = useCallback((e: React.DragEvent) => {
    return Array.from(e.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
  }, []);

  const getDropTargetFolderId = useCallback((e: React.DragEvent) => {
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
  }, []);

  const getFileExt = useCallback((file: File) => {
    const nameParts = file.name.split(".");
    const extFromName = nameParts.length > 1 ? nameParts.pop() : undefined;
    if (extFromName) {
      return extFromName.toLowerCase();
    }

    const mimePart = file.type.split("/")[1];
    return mimePart ? mimePart.toLowerCase() : "png";
  }, []);

  const fileToBase64 = useCallback((file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Failed to read dropped file as base64"));
          return;
        }

        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle drag and drop to import files while keeping internal DnD enabled.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isDraggingInternal && isExternalFileDrag(e)) {
      e.dataTransfer.dropEffect = "copy";
      dragCounterRef.current = 1;
      setIsDragging(true);
    }
  }, [isDraggingInternal, isExternalFileDrag]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDraggingInternal || !isExternalFileDrag(e)) {
      return;
    }

    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, [isDraggingInternal, isExternalFileDrag]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isDraggingInternal || !isExternalFileDrag(e)) {
      return;
    }

    dragCounterRef.current += 1;
    setIsDragging(true);
  }, [isDraggingInternal, isExternalFileDrag]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
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
      for (const path of paths) {
        await importFileFn(path, true, targetFolderId);
      }
    } else {
      const items = await Promise.all(
        Array.from(e.dataTransfer.files).map(async (file) => ({
          base64Data: await fileToBase64(file),
          ext: getFileExt(file),
        })),
      );

      if (items.length > 0) {
        await importImagesFromBase64(items, targetFolderId);
      }
    }

    if (dragOverFolderIdRef.current !== null) {
      setDragOverFolderId(null);
    }
  }, [
    fileToBase64,
    getDropTargetFolderId,
    getFileExt,
    getDroppedPaths,
    importFileFn,
    importImagesFromBase64,
    isDraggingInternal,
    isExternalFileDrag,
    setDragOverFolderId,
  ]);

  return (
    <div
      className="flex flex-col h-screen bg-gray-50 dark:bg-dark-bg"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && !isDraggingInternal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 bg-white dark:bg-dark-card rounded-xl shadow-2xl">
            <svg
              className="w-16 h-16 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
              拖放文件到此处导入
            </p>
          </div>
        </div>
      )}

      <Header onOpenSettings={() => setShowSettings(true)} />

      <div className="flex flex-1 overflow-hidden">
        <SidePanel />

        <main className="flex-1 overflow-hidden flex flex-col">
          {isFilterPanelOpen && <FilterPanel />}
          {previewMode ? <ImagePreview /> : <FileGrid />}
        </main>

        <DetailPanel />
      </div>

      {/* Drag overlay for internal file dragging */}
      {draggingFileId && (
        <div className="fixed inset-0 pointer-events-none z-50">
          <div
            className="absolute cursor-pointer"
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
          >
            <DragPreview fileId={draggingFileId} files={files} />
          </div>
        </div>
      )}

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
