import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import type { Modifier } from "@dnd-kit/core";
import { readFile } from '@tauri-apps/plugin-fs';
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";
import { useTagStore } from "@/stores/tagStore";
import { useFolderStore } from "@/stores/folderStore";
import Header from "@/components/Header";
import SidePanel from "@/components/SidePanel";
import FileGrid from "@/components/FileGrid";
import DetailPanel from "@/components/DetailPanel";
import SettingsModal from "@/components/SettingsModal";
import ImagePreview from "@/components/ImagePreview";

// Module-level deduplication state - persists across component re-renders
const dragDropState = {
  processedPaths: new Set<string>(),
  isProcessing: false,
  listenersReady: false,
};

// 拖拽预览组件
function DragPreview({ fileId, files }: { fileId: number; files: any[] }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  useEffect(() => {
    const file = files.find(f => f.id === fileId)
    if (!file) return

    let mounted = true
    readFile(file.path).then(contents => {
      if (mounted) {
        const blob = new Blob([contents])
        setImageSrc(URL.createObjectURL(blob))
      }
    }).catch(console.error)

    return () => {
      mounted = false
    }
  }, [fileId, files])

  return (
    <div className="w-24 h-24 bg-white dark:bg-dark-surface rounded-lg shadow-xl overflow-hidden">
      {imageSrc ? (
        <img src={imageSrc} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </div>
  )
}

function App() {
  const { theme, loadSettings } = useSettingsStore();

  // 调整拖拽预览位置 - 让预览图显示在鼠标下方偏右，指针在预览图左上角
  const adjustDragPosition = useCallback((args: Parameters<Modifier>[0]) => {
    const { transform } = args;
    // 预览图是 96x96 (w-24 h-24)，让预览图向右下偏移，指针在左上角
    return {
      ...transform,
      x: transform.x + 30,  // 向右偏移
      y: transform.y + 30,  // 向下偏移
    }
  }, []);
  const {
    importImagesFromBase64,
    importFile: importFileFn,
    previewMode,
    files,
  } = useFileStore();
  const { loadTags } = useTagStore();
  const { loadFolders, dragOverFolderId, setDragOverFolderId } = useFolderStore();
  const { isDraggingInternal, moveFile, loadFilesInFolder } = useFileStore();
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } })
  );

  // Handle drag end - move file to folder
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingFileId(null);
    if (over && active.data.current?.type === 'app-file' && over.data.current?.type === 'folder') {
      const fileId = active.data.current.fileId;
      const folderId = over.data.current.folderId;
      console.log('[DndContext] Moving file:', fileId, 'to folder:', folderId);
      await moveFile(fileId, folderId);
      // Refresh current folder's files
      const currentFolderId = useFolderStore.getState().selectedFolderId;
      await loadFilesInFolder(currentFolderId);
    }
  }, [moveFile, loadFilesInFolder]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    // 保存拖拽文件的 ID
    if (event.active.data.current?.type === 'app-file') {
      setDraggingFileId(event.active.data.current.fileId)
    }
  }, []);

  // Handle drag cancel
  const handleDragCancel = useCallback(() => {
    setDraggingFileId(null);
  }, []);

  // Use ref to store importFile function to prevent effect re-runs
  const importFileRef = useRef(importFileFn);
  importFileRef.current = importFileFn;

  useEffect(() => {
    loadSettings();
    loadTags();
    loadFolders();
  }, [loadSettings, loadTags, loadFolders]);

  // Listen for Tauri drag and drop events
  useEffect(() => {
    // Skip if listeners already set up
    if (dragDropState.listenersReady) {
      return;
    }

    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;
    let unlistenFileImported: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenDragEnter = await listen("tauri://drag-enter", () => {
        console.log('[Tauri] drag-enter, isDraggingInternal:', useFileStore.getState().isDraggingInternal)
        // Only set isDragging if this is not an internal drag
        if (!useFileStore.getState().isDraggingInternal) {
          setIsDragging(true);
        }
      });

      unlistenDragLeave = await listen("tauri://drag-leave", () => {
        console.log('[Tauri] drag-leave')
        // Only set isDragging if this is not an internal drag
        if (!useFileStore.getState().isDraggingInternal) {
          setIsDragging(false);
        }
      });

      unlistenDragDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        async (event) => {
          console.log('[Tauri] drag-drop, isDraggingInternal:', useFileStore.getState().isDraggingInternal)
          // Skip if this is an internal drag (handled by HTML5 drag)
          if (useFileStore.getState().isDraggingInternal) {
            console.log("[Tauri DragDrop] Skipping - internal drag");
            return;
          }

          // Prevent concurrent processing
          if (dragDropState.isProcessing) {
            console.log("[Tauri DragDrop] Skipping - already processing");
            return;
          }

          setIsDragging(false);
          console.log(
            "[Tauri DragDrop] paths:",
            event.payload.paths,
            "count:",
            event.payload.paths.length,
          );

          dragDropState.isProcessing = true;

          try {
            // Import each dropped file using ref, skip duplicates
            for (const path of event.payload.paths) {
              // Use source path as the key for deduplication
              if (!dragDropState.processedPaths.has(path)) {
                dragDropState.processedPaths.add(path);
                console.log("[Tauri DragDrop] importing:", path);

                try {
                  // Use dragOverFolderId if hovering over a folder, otherwise use selectedFolderId
                  const targetFolderId = dragOverFolderId !== null ? dragOverFolderId : undefined;
                  await importFileRef.current(path, true, targetFolderId);
                } catch (error) {
                  console.error("[Tauri DragDrop] Import error:", error);
                  // Remove from processed on error so user can retry
                  dragDropState.processedPaths.delete(path);
                }
              } else {
                console.log("[Tauri DragDrop] Skipping duplicate:", path);
              }
            }
          } finally {
            dragDropState.isProcessing = false;
            // Clear drag over folder state
            if (dragOverFolderId !== null) {
              setDragOverFolderId(null);
            }
            // Clean up processed paths after a delay
            setTimeout(() => {
              for (const path of event.payload.paths) {
                dragDropState.processedPaths.delete(path);
              }
            }, 2000);
          }
        },
      );

      // Listen for file imported from browser extension
      unlistenFileImported = await listen<{ file_id: number; path: string }>(
        "file-imported",
        async () => {
          console.log("[FileImported] Refreshing file list...");
          // Refresh current folder's files
          const folderId = useFolderStore.getState().selectedFolderId;
          await useFileStore.getState().loadFilesInFolder(folderId);
        },
      );

      dragDropState.listenersReady = true;
    };

    setupListeners();

    return () => {
      unlistenDragEnter?.();
      unlistenDragDrop?.();
      unlistenDragLeave?.();
      unlistenFileImported?.();
      dragDropState.listenersReady = false;
    };
  }, []);

  // Handle Ctrl+V paste to import images from clipboard
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      // Collect all images first
      const imageItems: { base64Data: string; ext: string }[] = [];

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          // Convert blob to base64 synchronously
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve((reader.result as string).split(",")[1]);
            };
            reader.readAsDataURL(blob);
          });

          // Determine file extension from MIME type
          const mimeType = blob.type;
          const ext = mimeType.split("/")[1] || "png";

          imageItems.push({ base64Data: base64, ext });
        }
      }

      // Batch import all images
      if (imageItems.length > 0) {
        await importImagesFromBase64(imageItems);
      }
    },
    [importImagesFromBase64],
  );

  // Handle drag and drop to import files (prevent default behavior)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Drop handling is done via Tauri events now
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, [handlePaste]);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  return (
    <div
      className="flex flex-col h-screen bg-gray-50 dark:bg-dark-bg"
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

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 overflow-hidden">
          <SidePanel />

          <main className="flex-1 overflow-hidden">
            {previewMode ? <ImagePreview /> : <FileGrid />}
          </main>

          <DetailPanel />
        </div>
        <DragOverlay modifiers={[adjustDragPosition]} dropAnimation={null}>
          {draggingFileId ? (
            <div className="cursor-pointer">
              <DragPreview fileId={draggingFileId} files={files} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}

export default App;
