import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
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

function App() {
  const { theme, loadSettings } = useSettingsStore();
  const {
    loadFiles,
    importImageFromBase64,
    importImagesFromBase64,
    importFile: importFileFn,
    previewMode,
  } = useFileStore();
  const { loadTags } = useTagStore();
  const { loadFolders } = useFolderStore();
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Use ref to store importFile function to prevent effect re-runs
  const importFileRef = useRef(importFileFn);
  importFileRef.current = importFileFn;

  useEffect(() => {
    loadSettings();
    loadFiles();
    loadTags();
    loadFolders();
  }, [loadSettings, loadFiles, loadTags, loadFolders]);

  // Listen for Tauri drag and drop events
  useEffect(() => {
    // Skip if listeners already set up
    if (dragDropState.listenersReady) {
      return;
    }

    let unlistenDragEnter: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;
    let unlistenDragLeave: (() => void) | undefined;

    const setupListeners = async () => {
      unlistenDragEnter = await listen("tauri://drag-enter", () => {
        setIsDragging(true);
      });

      unlistenDragLeave = await listen("tauri://drag-leave", () => {
        setIsDragging(false);
      });

      unlistenDragDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        async (event) => {
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
                  await importFileRef.current(path);
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
            // Clean up processed paths after a delay
            setTimeout(() => {
              for (const path of event.payload.paths) {
                dragDropState.processedPaths.delete(path);
              }
            }, 2000);
          }
        },
      );

      dragDropState.listenersReady = true;
    };

    setupListeners();

    return () => {
      unlistenDragEnter?.();
      unlistenDragDrop?.();
      unlistenDragLeave?.();
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
      {isDragging && (
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

        <main className="flex-1 overflow-hidden">
          {previewMode ? <ImagePreview /> : <FileGrid />}
        </main>

        <DetailPanel />
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}

export default App;
