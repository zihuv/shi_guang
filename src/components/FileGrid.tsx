import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { type FileItem } from "@/stores/fileTypes";
import { useFilterStore } from "@/stores/filterStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSelectionStore } from "@/stores/selectionStore";
import {
  getLibraryViewScaleRange,
  type LibraryViewMode,
  useSettingsStore,
} from "@/stores/settingsStore";
import { useTrashStore } from "@/stores/trashStore";
import { getActiveFilterCount } from "@/features/filters/schema";
import {
  FileGridPagination,
  FileGridSelectionBar,
  FileGridToolbar,
  type ToolbarMenu,
} from "@/components/file-grid/FileGridChrome";
import {
  getCurrentSortDirectionLabel,
  getCurrentSortFieldLabel,
  getCurrentViewModeLabel,
  getPrewarmCandidates,
  getVisibleInfoFieldLabels,
} from "@/components/file-grid/fileGridModel";
import { FileGridViewport } from "@/components/file-grid/FileGridViewport";
import {
  beginImagePreviewLoadGeneration,
  prewarmThumbHashPlaceholders,
  prewarmThumbnailImageSources,
} from "@/components/file-grid/fileGridPreviewLoader";
import { useFileGridKeyboardNavigation } from "@/components/file-grid/useFileGridKeyboardNavigation";
import { useFileGridSelectionDrag } from "@/components/file-grid/useFileGridSelectionDrag";
import { useFileGridLayouts } from "@/components/file-grid/useFileGridLayouts";
import { useFileGridToolbarDismiss } from "@/components/file-grid/useFileGridToolbarDismiss";
import { useFileGridViewScale } from "@/components/file-grid/useFileGridViewScale";
import { useFileGridViewportMetrics } from "@/components/file-grid/useFileGridViewportMetrics";

export default function FileGrid() {
  const files = useLibraryQueryStore((state) => state.files);
  const isLoading = useLibraryQueryStore((state) => state.isLoading);
  const pagination = useLibraryQueryStore((state) => state.pagination);
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery);
  const setPage = useLibraryQueryStore((state) => state.setPage);
  const setPageSize = useLibraryQueryStore((state) => state.setPageSize);
  const setPaginationMode = useLibraryQueryStore((state) => state.setPaginationMode);
  const resetPage = useLibraryQueryStore((state) => state.resetPage);
  const selectedFile = useSelectionStore((state) => state.selectedFile);
  const selectedFiles = useSelectionStore((state) => state.selectedFiles);
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const setSelectedFiles = useSelectionStore((state) => state.setSelectedFiles);
  const openPreview = usePreviewStore((state) => state.openPreview);
  const deleteFiles = useTrashStore((state) => state.deleteFiles);
  const isFilterPanelOpen = useFilterStore((state) => state.isFilterPanelOpen);
  const setFilterPanelOpen = useFilterStore((state) => state.setFilterPanelOpen);
  const toggleFilterPanel = useFilterStore((state) => state.toggleFilterPanel);
  const activeFilterCount = useFilterStore((state) => getActiveFilterCount(state.criteria));
  const sortBy = useFilterStore((state) => state.criteria.sortBy);
  const sortDirection = useFilterStore((state) => state.criteria.sortDirection);
  const setSortBy = useFilterStore((state) => state.setSortBy);
  const setSortDirection = useFilterStore((state) => state.setSortDirection);
  const activeSmartCollection = useNavigationStore((state) => state.activeSmartCollection);
  const viewMode = useSettingsStore((state) => state.libraryViewMode);
  const libraryViewScales = useSettingsStore((state) => state.libraryViewScales);
  const libraryVisibleFields = useSettingsStore((state) => state.libraryVisibleFields);
  const setLibraryViewMode = useSettingsStore((state) => state.setLibraryViewMode);
  const setLibraryViewScale = useSettingsStore((state) => state.setLibraryViewScale);
  const resetLibraryViewScale = useSettingsStore((state) => state.resetLibraryViewScale);
  const toggleLibraryVisibleField = useSettingsStore((state) => state.toggleLibraryVisibleField);
  const filteredFiles = files;
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarMenu | null>(null);
  const [previewLoadGeneration, setPreviewLoadGeneration] = useState(() =>
    beginImagePreviewLoadGeneration(),
  );

  const scrollParentRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuButtonRef = useRef<HTMLButtonElement>(null);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const layoutMenuButtonRef = useRef<HTMLButtonElement>(null);
  const infoMenuRef = useRef<HTMLDivElement>(null);
  const infoMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sortDidMountRef = useRef(false);

  const { isSelecting, selectionBox, handleSelectionStart } = useFileGridSelectionDrag({
    scrollParentRef,
    selectedFile,
    selectedFilesLength: selectedFiles.length,
    clearSelection,
    setSelectedFile,
    setSelectedFiles,
  });
  const { containerWidth, scrollTop, viewportHeight, scrollDirection } = useFileGridViewportMetrics(
    scrollParentRef,
    {
      isLoading,
      filesLength: files.length,
    },
  );
  const tileViewScale = libraryViewScales.grid;
  const listViewScale = libraryViewScales.list;
  const currentViewScale = viewMode === "list" ? listViewScale : tileViewScale;
  const currentViewScaleRange = getLibraryViewScaleRange(viewMode);
  const currentSortFieldLabel = getCurrentSortFieldLabel(sortBy, activeSmartCollection);
  const currentSortDirectionLabel = getCurrentSortDirectionLabel(
    sortDirection,
    activeSmartCollection,
  );
  const currentViewModeLabel = getCurrentViewModeLabel(viewMode);
  const visibleInfoFieldLabels = getVisibleInfoFieldLabels(libraryVisibleFields);
  const showPaginationControls = viewMode === "list";
  useFileGridToolbarDismiss({
    openToolbarMenu,
    isFilterPanelOpen,
    setOpenToolbarMenu,
    setFilterPanelOpen,
    scrollParentRef,
    filterMenuRef,
    filterMenuButtonRef,
    sortMenuRef,
    sortMenuButtonRef,
    layoutMenuRef,
    layoutMenuButtonRef,
    infoMenuRef,
    infoMenuButtonRef,
  });

  useEffect(() => {
    setPaginationMode(showPaginationControls ? "paged" : "flow");
  }, [setPaginationMode, showPaginationControls]);

  useEffect(() => {
    if (!sortDidMountRef.current) {
      sortDidMountRef.current = true;
      return;
    }

    resetPage();
    void runCurrentQuery();
  }, [resetPage, runCurrentQuery, sortBy, sortDirection]);

  const {
    adaptiveLayout,
    adaptiveVisibleItems,
    gridColumns,
    gridItemWidth,
    gridMetadataHeight,
    gridRowCount,
    gridRowHeight,
    gridRowSpan,
    gridTrackWidth,
    gridVirtualRows,
    listRowHeight,
    listThumbnailSize,
    listTotalSize,
    listVirtualItems,
  } = useFileGridLayouts({
    containerWidth,
    files: filteredFiles,
    libraryVisibleFields,
    listViewScale,
    scrollDirection,
    scrollParentRef,
    scrollTop,
    tileViewScale,
    viewportHeight,
  });

  useEffect(() => {
    if (!filteredFiles.length) {
      return;
    }

    setPreviewLoadGeneration(beginImagePreviewLoadGeneration());
  }, [filteredFiles]);

  useEffect(() => {
    if (!filteredFiles.length) {
      return;
    }

    const nextCandidates = getPrewarmCandidates({
      filteredFiles,
      viewMode,
      adaptiveVisibleItems,
      gridVirtualRows,
      gridColumns,
      listVirtualIndexes: listVirtualItems.map((virtualRow) => virtualRow.index),
      scrollDirection,
    });
    const prewarm = () => {
      const prewarmCandidates = nextCandidates.slice(0, 36);
      prewarmThumbHashPlaceholders(prewarmCandidates);
      prewarmThumbnailImageSources(prewarmCandidates, previewLoadGeneration);
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleHandle = window.requestIdleCallback(prewarm);
      return () => {
        if (typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(idleHandle);
        }
      };
    }

    const timeoutId = setTimeout(prewarm, 40);
    return () => clearTimeout(timeoutId);
  }, [
    adaptiveVisibleItems,
    filteredFiles,
    gridColumns,
    gridVirtualRows,
    listVirtualItems,
    previewLoadGeneration,
    scrollDirection,
    viewMode,
  ]);

  const handleViewModeChange = (nextViewMode: LibraryViewMode) => {
    setLibraryViewMode(nextViewMode);
    setOpenToolbarMenu(null);
  };

  const { applyCurrentViewScale, handleViewportWheel, resetCurrentViewScale } =
    useFileGridViewScale({
      currentViewScale,
      isSelecting,
      resetLibraryViewScale,
      setLibraryViewScale,
      viewMode,
    });

  const handleFileClick = (file: FileItem, event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    scrollParentRef.current?.focus({ preventScroll: true });

    if (event.ctrlKey || event.metaKey) {
      const nextSelectedIds = new Set<number>(selectedFiles);

      // Promote the current single selection into the multi-selection set.
      if (selectedFile) {
        nextSelectedIds.add(selectedFile.id);
      }

      if (nextSelectedIds.has(file.id)) {
        nextSelectedIds.delete(file.id);
      } else {
        nextSelectedIds.add(file.id);
      }

      setSelectedFiles(Array.from(nextSelectedIds));
      setSelectedFile(null);
      return;
    }

    if (selectedFiles.length > 0) {
      clearSelection();
    }

    setSelectedFile(file);
  };

  const handleFileDoubleClick = (index: number) => {
    openPreview(index, filteredFiles);
  };

  useFileGridKeyboardNavigation({
    adaptiveItems: adaptiveLayout.items,
    clearSelection,
    files: filteredFiles,
    gridColumns,
    gridRowHeight,
    gridRowSpan,
    isSelecting,
    listRowHeight,
    scrollParentRef,
    selectedFile,
    selectedFilesLength: selectedFiles.length,
    setSelectedFile,
    viewMode,
  });

  const handleBatchDelete = async () => {
    await deleteFiles(selectedFiles);
    setShowBatchDeleteConfirm(false);
  };

  return (
    <div className="flex h-full flex-col">
      <FileGridToolbar
        activeFilterCount={activeFilterCount}
        applyCurrentViewScale={applyCurrentViewScale}
        currentSortDirectionLabel={currentSortDirectionLabel}
        currentSortFieldLabel={currentSortFieldLabel}
        currentViewModeLabel={currentViewModeLabel}
        currentViewScale={currentViewScale}
        currentViewScaleRange={currentViewScaleRange}
        filterMenuButtonRef={filterMenuButtonRef}
        filterMenuRef={filterMenuRef}
        filteredFileCount={filteredFiles.length}
        handleViewModeChange={handleViewModeChange}
        infoMenuButtonRef={infoMenuButtonRef}
        infoMenuRef={infoMenuRef}
        isFilterPanelOpen={isFilterPanelOpen}
        layoutMenuButtonRef={layoutMenuButtonRef}
        layoutMenuRef={layoutMenuRef}
        libraryVisibleFields={libraryVisibleFields}
        openToolbarMenu={openToolbarMenu}
        paginationLabel={
          showPaginationControls && pagination.totalPages > 1
            ? `(第 ${pagination.page}/${pagination.totalPages} 页)`
            : undefined
        }
        resetCurrentViewScale={resetCurrentViewScale}
        setOpenToolbarMenu={setOpenToolbarMenu}
        setSortBy={setSortBy}
        setSortDirection={setSortDirection}
        sortLocked={activeSmartCollection === "random" || activeSmartCollection === "recent"}
        sortBy={sortBy}
        sortDirection={sortDirection}
        sortMenuButtonRef={sortMenuButtonRef}
        sortMenuRef={sortMenuRef}
        toggleFilterPanel={toggleFilterPanel}
        toggleLibraryVisibleField={toggleLibraryVisibleField}
        viewMode={viewMode}
        visibleInfoFieldLabels={visibleInfoFieldLabels}
      />

      {isLoading && files.length === 0 ? (
        <div className="flex flex-1" aria-hidden="true" />
      ) : files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-500 dark:text-gray-400">
          <svg
            className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-lg font-medium">暂无文件</p>
          <p className="mt-1 text-sm">当前目录下暂无文件</p>
        </div>
      ) : (
        <FileGridViewport
          adaptiveLayout={adaptiveLayout}
          adaptiveVisibleItems={adaptiveVisibleItems}
          filteredFiles={filteredFiles}
          gridColumns={gridColumns}
          gridItemWidth={gridItemWidth}
          gridMetadataHeight={gridMetadataHeight}
          gridRowCount={gridRowCount}
          gridRowHeight={gridRowHeight}
          gridRowSpan={gridRowSpan}
          gridTrackWidth={gridTrackWidth}
          gridVirtualRows={gridVirtualRows}
          handleFileClick={handleFileClick}
          handleFileDoubleClick={handleFileDoubleClick}
          handleSelectionStart={handleSelectionStart}
          handleViewportWheel={handleViewportWheel}
          libraryVisibleFields={libraryVisibleFields}
          listThumbnailSize={listThumbnailSize}
          listTotalSize={listTotalSize}
          listVirtualItems={listVirtualItems}
          previewLoadGeneration={previewLoadGeneration}
          scrollParentRef={scrollParentRef}
          selectedFileId={selectedFile?.id ?? null}
          selectedFiles={selectedFiles}
          selectionBox={selectionBox}
          viewMode={viewMode}
        />
      )}

      {showPaginationControls && (
        <FileGridPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalPages={pagination.totalPages}
          setPage={setPage}
          setPageSize={setPageSize}
        />
      )}

      <FileGridSelectionBar
        selectedCount={selectedFiles.length}
        showBatchDeleteConfirm={showBatchDeleteConfirm}
        clearSelection={clearSelection}
        handleBatchDelete={handleBatchDelete}
        setShowBatchDeleteConfirm={setShowBatchDeleteConfirm}
      />
    </div>
  );
}
