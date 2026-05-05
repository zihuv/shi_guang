import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAiBatchAnalyzeStore } from "@/stores/aiBatchAnalyzeStore";
import { useBootstrapStore } from "@/stores/bootstrapStore";
import { useFolderStore } from "@/stores/folderStore";
import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import Header from "@/components/Header";
import SidePanel from "@/components/SidePanel";
import FileGrid from "@/components/FileGrid";
import DetailPanel from "@/components/DetailPanel";
import DragPreview from "@/components/DragPreview";
import AppStartupScreen from "@/components/AppStartupScreen";
import TagPanel from "@/components/TagPanel";
import TrashPanel from "@/components/TrashPanel";
import { PanelResizeHandle, PanelRestoreToggle } from "@/components/app-shell/PanelControls";
import { useAppPanelLayout } from "@/hooks/useAppPanelLayout";
import { useAppInitialization } from "@/hooks/useAppInitialization";
import { useClipboardImport } from "@/hooks/useClipboardImport";
import { useDocumentTheme } from "@/hooks/useDocumentTheme";
import { useExternalImportDrop } from "@/hooks/useExternalImportDrop";
import { useInternalFileDrag } from "@/hooks/useInternalFileDrag";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useDesktopImportListeners } from "@/hooks/useDesktopImportListeners";
import { useNavigationStore } from "@/stores/navigationStore";

const ImagePreview = lazy(() => import("@/components/ImagePreview"));
const SettingsModal = lazy(() => import("@/components/SettingsModal"));

function App() {
  const hasBootstrapped = useBootstrapStore((state) => state.hasBootstrapped);
  const bootstrapError = useBootstrapStore((state) => state.bootstrapError);
  const theme = useSettingsStore((state) => state.theme);

  const { importBinaryImages, importFiles } = useImportStore();
  const previewMode = usePreviewStore((state) => state.previewMode);
  const closePreview = usePreviewStore((state) => state.closePreview);
  const files = useLibraryQueryStore((state) => state.files);
  const { dragOverFolderId, setDragOverFolderId } = useFolderStore();
  const isDraggingInternal = useSelectionStore((state) => state.isDraggingInternal);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile);
  const currentView = useNavigationStore((state) => state.currentView);
  const showsLibraryView = currentView === "library";
  const [showSettings, setShowSettings] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null);
  const {
    activeResizeHandle,
    contentContainerRef,
    detailPanelWidth,
    handleResizeStart,
    isSidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
  } = useAppPanelLayout({ showsDetailPanel: showsLibraryView });
  const showsDetailPanel = showsLibraryView;
  const { handleDragEnter, handleDragLeave, handleDragOver, handleDrop, isDragging } =
    useExternalImportDrop({
      dragOverFolderId,
      importFiles,
      isDraggingInternal,
      setDragOverFolderId,
    });

  useAppInitialization();
  useInternalFileDrag(setDraggingFileId);
  useDesktopImportListeners();
  useClipboardImport(importBinaryImages);
  useDocumentTheme(theme);
  useKeyboardShortcuts();

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    Object.assign(
      window as Window & {
        __SHIGUANG_DEBUG__?: {
          aiBatchAnalyzeStore: typeof useAiBatchAnalyzeStore;
          importStore: typeof useImportStore;
          libraryQueryStore: typeof useLibraryQueryStore;
          previewStore: typeof usePreviewStore;
          selectionStore: typeof useSelectionStore;
          folderStore: typeof useFolderStore;
        };
      },
      {
        __SHIGUANG_DEBUG__: {
          aiBatchAnalyzeStore: useAiBatchAnalyzeStore,
          importStore: useImportStore,
          libraryQueryStore: useLibraryQueryStore,
          previewStore: usePreviewStore,
          selectionStore: useSelectionStore,
          folderStore: useFolderStore,
        },
      },
    );
  }, []);

  useEffect(() => {
    if (currentView === "library") {
      return;
    }

    closePreview();
    clearSelection();
    setSelectedFile(null);
  }, [clearSelection, closePreview, currentView, setSelectedFile]);

  if (!hasBootstrapped) {
    return (
      <AppStartupScreen
        sidebarWidth={sidebarWidth}
        detailPanelWidth={detailPanelWidth}
        errorMessage={bootstrapError}
      />
    );
  }

  return (
    <div
      className="app-shell flex h-screen flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && !isDraggingInternal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none">
          <div className="app-card-surface flex flex-col items-center gap-4 rounded-2xl p-8 dark:bg-dark-surface">
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
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
              拖放文件或文件夹到此处导入
            </p>
          </div>
        </div>
      )}

      <Header onOpenSettings={() => setShowSettings(true)} />

      <div ref={contentContainerRef} className="relative flex flex-1 overflow-hidden">
        {!isSidebarCollapsed ? (
          <>
            <SidePanel width={sidebarWidth} onCollapse={() => setSidebarCollapsed(true)} />

            <PanelResizeHandle
              ariaLabel="调整左侧面板宽度"
              isActive={activeResizeHandle === "sidebar"}
              onMouseDown={handleResizeStart("sidebar")}
            />
          </>
        ) : null}

        {isSidebarCollapsed ? (
          <PanelRestoreToggle
            ariaLabel="展开左侧栏"
            title="展开左侧栏"
            onClick={() => setSidebarCollapsed(false)}
          />
        ) : null}

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {currentView === "library" ? <FileGrid /> : null}
          {currentView === "tags" ? <TagPanel /> : null}
          {currentView === "trash" ? <TrashPanel /> : null}
          <Suspense fallback={null}>
            {showsLibraryView && previewMode ? (
              <div className="absolute inset-0 z-20">
                <ImagePreview />
              </div>
            ) : null}
          </Suspense>
        </main>

        {showsDetailPanel ? (
          <>
            <PanelResizeHandle
              ariaLabel="调整右侧面板宽度"
              isActive={activeResizeHandle === "detail"}
              onMouseDown={handleResizeStart("detail")}
            />

            <DetailPanel width={detailPanelWidth} />
          </>
        ) : null}
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

      <Suspense fallback={null}>
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      </Suspense>
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
