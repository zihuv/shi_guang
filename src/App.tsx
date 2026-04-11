import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import {
  MAX_DETAIL_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  clampDetailPanelWidth,
  clampSidebarWidth,
  useSettingsStore,
} from "@/stores/settingsStore";
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
import { useAppInitialization } from "@/hooks/useAppInitialization";
import { useClipboardImport } from "@/hooks/useClipboardImport";
import { useDocumentTheme } from "@/hooks/useDocumentTheme";
import { useInternalFileDrag } from "@/hooks/useInternalFileDrag";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTauriImportListeners } from "@/hooks/useTauriImportListeners";

const PANEL_RESIZER_WIDTH = 11;
const PANEL_RESIZER_LAYOUT_WIDTH = 1;
const PANEL_RESIZER_MARGIN = (PANEL_RESIZER_WIDTH - PANEL_RESIZER_LAYOUT_WIDTH) / 2;
const PANEL_RESIZER_TOTAL_WIDTH = PANEL_RESIZER_LAYOUT_WIDTH * 2;
const MIN_MAIN_PANEL_WIDTH = 240;
const MIN_RENDERED_SIDEBAR_WIDTH = 72;
const MIN_RENDERED_DETAIL_PANEL_WIDTH = 120;
const ImagePreview = lazy(() => import("@/components/ImagePreview"));
const SettingsModal = lazy(() => import("@/components/SettingsModal"));

type ResizeHandle = "sidebar" | "detail";

function clampDraggedWidth(value: number, minWidth: number, maxWidth: number) {
  const safeMaxWidth = Math.max(0, maxWidth);
  if (safeMaxWidth <= minWidth) {
    return safeMaxWidth;
  }

  return Math.max(minWidth, Math.min(safeMaxWidth, value));
}

function constrainPanelWidths(
  containerWidth: number,
  requestedSidebarWidth: number,
  requestedDetailPanelWidth: number,
) {
  let sidebarWidth = clampSidebarWidth(requestedSidebarWidth);
  let detailPanelWidth = clampDetailPanelWidth(requestedDetailPanelWidth);

  if (containerWidth <= 0) {
    return { sidebarWidth, detailPanelWidth };
  }

  const maxCombinedPanelWidth = Math.max(
    0,
    containerWidth - PANEL_RESIZER_TOTAL_WIDTH - MIN_MAIN_PANEL_WIDTH,
  );
  let overflow = sidebarWidth + detailPanelWidth - maxCombinedPanelWidth;

  if (overflow <= 0) {
    return { sidebarWidth, detailPanelWidth };
  }

  const detailPanelReducible = Math.max(
    0,
    detailPanelWidth - MIN_RENDERED_DETAIL_PANEL_WIDTH,
  );
  const detailPanelReduction = Math.min(detailPanelReducible, overflow);
  detailPanelWidth -= detailPanelReduction;
  overflow -= detailPanelReduction;

  const sidebarReducible = Math.max(
    0,
    sidebarWidth - MIN_RENDERED_SIDEBAR_WIDTH,
  );
  const sidebarReduction = Math.min(sidebarReducible, overflow);
  sidebarWidth -= sidebarReduction;
  overflow -= sidebarReduction;

  if (overflow > 0) {
    detailPanelWidth = Math.max(48, detailPanelWidth - overflow);
  }

  return {
    sidebarWidth: Math.max(48, Math.round(sidebarWidth)),
    detailPanelWidth: Math.max(48, Math.round(detailPanelWidth)),
  };
}

function PanelResizeHandle({
  ariaLabel,
  isActive,
  onMouseDown,
}: {
  ariaLabel: string;
  isActive: boolean;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className="group relative z-10 flex flex-shrink-0 cursor-col-resize items-stretch justify-center select-none"
      style={{
        width: PANEL_RESIZER_WIDTH,
        marginLeft: -PANEL_RESIZER_MARGIN,
        marginRight: -PANEL_RESIZER_MARGIN,
      }}
      onMouseDown={onMouseDown}
    >
      <div
        className={`h-full w-px transition-colors ${
          isActive
            ? "bg-blue-400 dark:bg-blue-500"
            : "bg-gray-200 group-hover:bg-gray-300 dark:bg-dark-border dark:group-hover:bg-gray-500"
        }`}
      />
    </div>
  );
}

function App() {
  const theme = useSettingsStore((state) => state.theme);
  const sidebarWidthPreference = useSettingsStore((state) => state.sidebarWidth);
  const detailPanelWidthPreference = useSettingsStore((state) => state.detailPanelWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const setDetailPanelWidth = useSettingsStore((state) => state.setDetailPanelWidth);

  const {
    importImagesFromBase64,
    importFiles,
  } = useImportStore();
  const previewMode = usePreviewStore((state) => state.previewMode);
  const files = useLibraryQueryStore((state) => state.files);
  const { dragOverFolderId, setDragOverFolderId } = useFolderStore();
  const isDraggingInternal = useSelectionStore((state) => state.isDraggingInternal);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null);
  const dragCounterRef = useRef(0);
  const dragOverFolderIdRef = useRef<number | null>(dragOverFolderId);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const activeResizeHandleRef = useRef<ResizeHandle | null>(null);

  const { sidebarWidth, detailPanelWidth } = constrainPanelWidths(
    contentWidth,
    sidebarWidthPreference,
    detailPanelWidthPreference,
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const detailPanelWidthRef = useRef(detailPanelWidth);

  dragOverFolderIdRef.current = dragOverFolderId;
  sidebarWidthRef.current = sidebarWidth;
  detailPanelWidthRef.current = detailPanelWidth;

  useAppInitialization();
  useInternalFileDrag(setDraggingFileId);
  useTauriImportListeners({
    dragOverFolderId,
    setDragOverFolderId,
    setIsDragging,
    importFiles,
  });
  useClipboardImport(importImagesFromBase64);
  useDocumentTheme(theme);
  useKeyboardShortcuts();

  useEffect(() => {
    const element = contentContainerRef.current;
    if (!element) {
      return undefined;
    }

    const updateContentWidth = () => {
      setContentWidth(element.clientWidth);
    };

    updateContentWidth();

    const observer = new ResizeObserver(() => {
      updateContentWidth();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    Object.assign(window as Window & {
      __SHIGUANG_DEBUG__?: {
        importStore: typeof useImportStore;
        libraryQueryStore: typeof useLibraryQueryStore;
        previewStore: typeof usePreviewStore;
        selectionStore: typeof useSelectionStore;
        folderStore: typeof useFolderStore;
      };
    }, {
      __SHIGUANG_DEBUG__: {
        importStore: useImportStore,
        libraryQueryStore: useLibraryQueryStore,
        previewStore: usePreviewStore,
        selectionStore: useSelectionStore,
        folderStore: useFolderStore,
      },
    });
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const activeHandle = activeResizeHandleRef.current;
      const container = contentContainerRef.current;
      if (!activeHandle || !container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const nextContentWidth = rect.width;

      if (activeHandle === "sidebar") {
        const maxSidebarWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          nextContentWidth -
            detailPanelWidthRef.current -
            PANEL_RESIZER_TOTAL_WIDTH -
            MIN_MAIN_PANEL_WIDTH,
        );
        const nextSidebarWidth = clampDraggedWidth(
          event.clientX - rect.left,
          MIN_RENDERED_SIDEBAR_WIDTH,
          maxSidebarWidth,
        );
        setSidebarWidth(nextSidebarWidth);
        return;
      }

      const maxDetailWidth = Math.min(
        MAX_DETAIL_PANEL_WIDTH,
        nextContentWidth -
          sidebarWidthRef.current -
          PANEL_RESIZER_TOTAL_WIDTH -
          MIN_MAIN_PANEL_WIDTH,
      );
      const nextDetailWidth = clampDraggedWidth(
        rect.right - event.clientX,
        MIN_RENDERED_DETAIL_PANEL_WIDTH,
        maxDetailWidth,
      );
      setDetailPanelWidth(nextDetailWidth);
    };

    const stopResize = () => {
      if (!activeResizeHandleRef.current) {
        return;
      }

      activeResizeHandleRef.current = null;
      setActiveResizeHandle(null);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("blur", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("blur", stopResize);
      stopResize();
    };
  }, [setDetailPanelWidth, setSidebarWidth]);

  const handleResizeStart = useCallback((handle: ResizeHandle) => {
    return (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      activeResizeHandleRef.current = handle;
      setActiveResizeHandle(handle);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
  }, []);

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
      void importFiles(paths, targetFolderId);
    } else {
      const items = await Promise.all(
        Array.from(e.dataTransfer.files).map(async (file) => ({
          base64Data: await fileToBase64(file),
          ext: getFileExt(file),
        })),
      );

      if (items.length > 0) {
        void importImagesFromBase64(items, targetFolderId);
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
    importFiles,
    importImagesFromBase64,
    isDraggingInternal,
    isExternalFileDrag,
    setDragOverFolderId,
  ]);

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
              拖放文件到此处导入
            </p>
          </div>
        </div>
      )}

      <Header onOpenSettings={() => setShowSettings(true)} />

      <div ref={contentContainerRef} className="flex flex-1 overflow-hidden">
        <SidePanel width={sidebarWidth} />

        <PanelResizeHandle
          ariaLabel="调整左侧面板宽度"
          isActive={activeResizeHandle === "sidebar"}
          onMouseDown={handleResizeStart("sidebar")}
        />

        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          <Suspense fallback={null}>
            {previewMode ? <ImagePreview /> : <FileGrid />}
          </Suspense>
        </main>

        <PanelResizeHandle
          ariaLabel="调整右侧面板宽度"
          isActive={activeResizeHandle === "detail"}
          onMouseDown={handleResizeStart("detail")}
        />

        <DetailPanel width={detailPanelWidth} />
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
        <SettingsModal
          open={showSettings}
          onClose={() => setShowSettings(false)}
        />
      </Suspense>
      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
