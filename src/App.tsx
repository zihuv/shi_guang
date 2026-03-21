import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { readFile } from '@tauri-apps/plugin-fs';
import { toast, Toaster } from 'sonner';
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";
import { useTagStore } from "@/stores/tagStore";
import { useFolderStore } from "@/stores/folderStore";
import { useFilterStore } from "@/stores/filterStore";
import Header from "@/components/Header";
import SidePanel from "@/components/SidePanel";
import FileGrid from "@/components/FileGrid";
import DetailPanel from "@/components/DetailPanel";
import SettingsModal from "@/components/SettingsModal";
import ImagePreview from "@/components/ImagePreview";
import FilterPanel from "@/components/FilterPanel";

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
  const initRef = useRef(false);

  const {
    importImagesFromBase64,
    importFile: importFileFn,
    previewMode,
    files,
  } = useFileStore();
  const { loadTags } = useTagStore();
  const { dragOverFolderId, setDragOverFolderId } = useFolderStore();
  const { isFilterPanelOpen } = useFilterStore();
  const { isDraggingInternal } = useFileStore();
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null);

  // Use ref to store importFile function to prevent effect re-runs
  const importFileRef = useRef(importFileFn);
  importFileRef.current = importFileFn;

  // Monitor drag events at the document level
  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === 'app-file') {
          setDraggingFileId(source.data.fileId as number)
        }
      },
      onDrop: ({ source }) => {
        if (source.data.type === 'app-file') {
          setDraggingFileId(null)
        }
      }
    })
  }, [])

  // Setup drag-drop event listeners and initial data load
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    loadSettings();
    loadTags();
    // loadFolders is called by SidePanel component
  }, [loadSettings, loadTags]);

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
    let unlistenFileImportError: (() => void) | undefined;

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

      // Listen for file imported from browser extension - success
      unlistenFileImported = await listen<{ file_id: number; path: string }>(
        "file-imported",
        async () => {
          console.log("[FileImported] Refreshing file list...");
          toast.success("图片导入成功");
          // Refresh current folder's files
          const folderId = useFolderStore.getState().selectedFolderId;
          await useFileStore.getState().loadFilesInFolder(folderId);
        },
      );

      // Listen for file import error from browser extension
      await listen<{ error: string }>(
        "file-import-error",
        async (event) => {
          console.log("[FileImportError]", event.payload.error);
          toast.error(`图片导入失败: ${event.payload.error}`);
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
      unlistenFileImportError?.();
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

  // Handle Ctrl+Z for undo delete operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        const { undo } = useFileStore.getState();
        undo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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
          <div className="absolute cursor-pointer" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>
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
