import { type RefObject } from "react";
import { ArrowUpDown, Filter } from "lucide-react";
import { type FileSortField, type SortDirection } from "@/stores/filterStore";
import { type LibraryViewMode, type LibraryVisibleField } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { InfoDisplayIcon, ViewModeIcon } from "@/components/file-grid/fileGridCards";
import FilterPanel from "@/components/FilterPanel";

export type ToolbarMenu = "sort" | "layout" | "info";

const SORT_DIRECTION_OPTIONS: Array<{ value: SortDirection; label: string }> = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" },
];

const SORT_FIELD_OPTIONS: Array<{ value: FileSortField; label: string }> = [
  { value: "imported_at", label: "导入时间" },
  { value: "created_at", label: "创建时间" },
  { value: "modified_at", label: "修改时间" },
  { value: "name", label: "名称" },
  { value: "ext", label: "类型" },
  { value: "size", label: "文件大小" },
];

const VIEW_MODE_OPTIONS: Array<{ value: LibraryViewMode; label: string }> = [
  { value: "grid", label: "网格" },
  { value: "adaptive", label: "自适应" },
  { value: "list", label: "列表" },
];

const INFO_FIELD_OPTIONS: Array<{ value: LibraryVisibleField; label: string }> = [
  { value: "name", label: "名称" },
  { value: "ext", label: "类型" },
  { value: "size", label: "文件大小" },
  { value: "dimensions", label: "尺寸" },
  { value: "tags", label: "标签" },
];

const TOOLBAR_BUTTON_CLASS_NAME =
  "relative inline-flex size-8 items-center justify-center rounded-[10px] border text-gray-500 transition-colors";

function getToolbarButtonClassName(isActive: boolean) {
  return cn(
    TOOLBAR_BUTTON_CLASS_NAME,
    isActive
      ? "border-gray-200 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-dark-border dark:text-gray-100"
      : "border-transparent bg-transparent hover:border-gray-200/80 hover:bg-gray-100/80 hover:text-gray-700 dark:hover:border-dark-border dark:hover:bg-dark-border dark:hover:text-gray-200",
  );
}

interface FileGridToolbarProps {
  activeFilterCount: number;
  currentSortDirectionLabel: string;
  currentSortFieldLabel: string;
  currentViewModeLabel: string;
  currentViewScale: number;
  currentViewScaleRange: { min: number; max: number };
  filteredFileCount: number;
  isFilterPanelOpen: boolean;
  libraryVisibleFields: LibraryVisibleField[];
  openToolbarMenu: ToolbarMenu | null;
  paginationLabel?: string;
  resetCurrentViewScale: () => void;
  setOpenToolbarMenu: (menu: ToolbarMenu | null) => void;
  setSortBy: (sortBy: FileSortField) => void;
  setSortDirection: (sortDirection: SortDirection) => void;
  toggleFilterPanel: () => void;
  toggleLibraryVisibleField: (field: LibraryVisibleField) => void;
  handleViewModeChange: (mode: LibraryViewMode) => void;
  applyCurrentViewScale: (scale: number) => void;
  filterMenuButtonRef: RefObject<HTMLButtonElement | null>;
  filterMenuRef: RefObject<HTMLDivElement | null>;
  layoutMenuButtonRef: RefObject<HTMLButtonElement | null>;
  layoutMenuRef: RefObject<HTMLDivElement | null>;
  infoMenuButtonRef: RefObject<HTMLButtonElement | null>;
  infoMenuRef: RefObject<HTMLDivElement | null>;
  sortMenuButtonRef: RefObject<HTMLButtonElement | null>;
  sortMenuRef: RefObject<HTMLDivElement | null>;
  sortBy: FileSortField;
  sortDirection: SortDirection;
  viewMode: LibraryViewMode;
  visibleInfoFieldLabels: string[];
}

export function FileGridToolbar({
  activeFilterCount,
  applyCurrentViewScale,
  currentSortDirectionLabel,
  currentSortFieldLabel,
  currentViewModeLabel,
  currentViewScale,
  currentViewScaleRange,
  filterMenuButtonRef,
  filterMenuRef,
  filteredFileCount,
  handleViewModeChange,
  infoMenuButtonRef,
  infoMenuRef,
  isFilterPanelOpen,
  layoutMenuButtonRef,
  layoutMenuRef,
  libraryVisibleFields,
  openToolbarMenu,
  paginationLabel,
  resetCurrentViewScale,
  setOpenToolbarMenu,
  setSortBy,
  setSortDirection,
  sortBy,
  sortDirection,
  sortMenuButtonRef,
  sortMenuRef,
  toggleFilterPanel,
  toggleLibraryVisibleField,
  viewMode,
  visibleInfoFieldLabels,
}: FileGridToolbarProps) {
  const toggleToolbarMenu = (menu: ToolbarMenu) => {
    setOpenToolbarMenu(openToolbarMenu === menu ? null : menu);
  };

  return (
    <div className="relative z-20 border-b border-gray-200/80 bg-white/78 backdrop-blur-xl dark:border-dark-border dark:bg-dark-surface/78">
      <div className="flex h-11 items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <span className="truncate text-[13px] text-gray-500 dark:text-gray-400">
            {filteredFileCount} 个文件
            {paginationLabel ? ` ${paginationLabel}` : ""}
            {activeFilterCount > 0 ? ` · 已筛选 ${activeFilterCount} 项` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            ref={filterMenuButtonRef}
            type="button"
            onClick={() => {
              setOpenToolbarMenu(null);
              toggleFilterPanel();
            }}
            className={getToolbarButtonClassName(activeFilterCount > 0)}
            title={activeFilterCount > 0 ? `筛选：已启用 ${activeFilterCount} 项` : "筛选"}
            aria-label="筛选"
            aria-expanded={isFilterPanelOpen}
            aria-pressed={isFilterPanelOpen}
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilterCount > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-gray-700 shadow-sm dark:bg-black/20 dark:text-gray-100">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="relative">
            <button
              ref={sortMenuButtonRef}
              type="button"
              onClick={() => toggleToolbarMenu("sort")}
              className={getToolbarButtonClassName(openToolbarMenu === "sort")}
              title={`排序：${currentSortFieldLabel} · ${currentSortDirectionLabel}`}
              aria-label="排序"
              aria-expanded={openToolbarMenu === "sort"}
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>

            {openToolbarMenu === "sort" && (
              <div
                ref={sortMenuRef}
                className="absolute right-0 top-10 z-30 w-52 rounded-2xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="app-kicker px-3 pb-1 pt-2 text-gray-400">排序方式</div>
                {SORT_DIRECTION_OPTIONS.map((option) => {
                  const isActive = sortDirection === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortDirection(option.value);
                        setOpenToolbarMenu(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                        isActive
                          ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-border",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isActive ? "bg-current" : "bg-transparent",
                        )}
                      />
                      <span>{option.label}</span>
                    </button>
                  );
                })}

                <div className="my-1.5 h-px bg-gray-100 dark:bg-dark-border" />

                <div className="app-kicker px-3 pb-1 pt-1 text-gray-400">排序依据</div>
                {SORT_FIELD_OPTIONS.map((option) => {
                  const isActive = sortBy === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortBy(option.value);
                        setOpenToolbarMenu(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                        isActive
                          ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-border",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isActive ? "bg-current" : "bg-transparent",
                        )}
                      />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              ref={infoMenuButtonRef}
              type="button"
              onClick={() => toggleToolbarMenu("info")}
              className={getToolbarButtonClassName(openToolbarMenu === "info")}
              title={`信息显示：${visibleInfoFieldLabels.join(" · ") || "无"}`}
              aria-label="信息显示"
              aria-expanded={openToolbarMenu === "info"}
            >
              <InfoDisplayIcon className="h-4 w-4" />
            </button>

            {openToolbarMenu === "info" && (
              <div
                ref={infoMenuRef}
                className="absolute right-0 top-10 z-30 w-52 rounded-2xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="app-kicker px-3 pb-1 pt-2 text-gray-400">信息显示</div>
                {INFO_FIELD_OPTIONS.map((option) => {
                  const isActive = libraryVisibleFields.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleLibraryVisibleField(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                        isActive
                          ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-border",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                          isActive
                            ? "border-current bg-current/10"
                            : "border-gray-300 text-transparent dark:border-gray-600",
                        )}
                      >
                        ✓
                      </span>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              ref={layoutMenuButtonRef}
              type="button"
              onClick={() => toggleToolbarMenu("layout")}
              className={getToolbarButtonClassName(openToolbarMenu === "layout")}
              title={`布局：${currentViewModeLabel}`}
              aria-label="布局"
              aria-expanded={openToolbarMenu === "layout"}
            >
              <ViewModeIcon mode={viewMode} className="h-4 w-4" />
            </button>

            {openToolbarMenu === "layout" && (
              <div
                ref={layoutMenuRef}
                className="absolute right-0 top-10 z-30 w-44 rounded-2xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="app-kicker px-3 pb-1 pt-2 text-gray-400">布局</div>
                {VIEW_MODE_OPTIONS.map((option) => {
                  const isActive = viewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleViewModeChange(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                        isActive
                          ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-border",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isActive ? "bg-current" : "bg-transparent",
                        )}
                      />
                      <ViewModeIcon mode={option.value} className="h-4 w-4 flex-shrink-0" />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="hidden items-center sm:flex" onDoubleClick={resetCurrentViewScale}>
            <input
              type="range"
              min={currentViewScaleRange.min}
              max={currentViewScaleRange.max}
              step={0.02}
              value={currentViewScale}
              onChange={(event) => applyCurrentViewScale(Number(event.target.value))}
              className="h-1 w-14 cursor-pointer accent-gray-400 opacity-70 transition-opacity hover:opacity-100 dark:accent-gray-500"
              aria-label="当前视图缩放"
            />
          </div>
        </div>
      </div>

      {isFilterPanelOpen && (
        <div
          ref={filterMenuRef}
          className="border-t border-gray-200/80 px-4 py-3 dark:border-dark-border/80"
        >
          <FilterPanel />
        </div>
      )}
    </div>
  );
}

interface FileGridPaginationProps {
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}

export function FileGridPagination({
  page,
  pageSize,
  totalPages,
  setPage,
  setPageSize,
}: FileGridPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-center gap-2 border-t border-gray-200 py-2 dark:border-dark-border">
      <button
        onClick={() => setPage(1)}
        disabled={page <= 1}
        className="rounded-lg px-2.5 py-1 text-[13px] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
      >
        首页
      </button>
      <button
        onClick={() => setPage(page - 1)}
        disabled={page <= 1}
        className="rounded-lg px-2.5 py-1 text-[13px] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
      >
        上一页
      </button>
      <span className="text-[13px] text-gray-600 dark:text-gray-400">
        第 {page} / {totalPages} 页
      </span>
      <button
        onClick={() => setPage(page + 1)}
        disabled={page >= totalPages}
        className="rounded-lg px-2.5 py-1 text-[13px] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
      >
        下一页
      </button>
      <button
        onClick={() => setPage(totalPages)}
        disabled={page >= totalPages}
        className="rounded-lg px-2.5 py-1 text-[13px] hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
      >
        末页
      </button>
      <select
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
        className="ml-2 rounded-lg border px-2 py-1 text-[13px] hover:bg-gray-50 dark:hover:bg-dark-border"
      >
        <option value={50}>50/页</option>
        <option value={100}>100/页</option>
        <option value={200}>200/页</option>
        <option value={500}>500/页</option>
      </select>
    </div>
  );
}

interface FileGridSelectionBarProps {
  selectedCount: number;
  showBatchDeleteConfirm: boolean;
  clearSelection: () => void;
  handleBatchDelete: () => Promise<void>;
  setShowBatchDeleteConfirm: (open: boolean) => void;
}

export function FileGridSelectionBar({
  selectedCount,
  showBatchDeleteConfirm,
  clearSelection,
  handleBatchDelete,
  setShowBatchDeleteConfirm,
}: FileGridSelectionBarProps) {
  if (selectedCount <= 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 transform flex-wrap items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2 shadow-xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/96">
      <span className="whitespace-nowrap text-[13px] font-medium text-gray-700 dark:text-gray-200">
        已选择 {selectedCount} 个文件
      </span>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={clearSelection}
          className="whitespace-nowrap rounded-xl bg-gray-100 px-3 py-1 text-[13px] text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          取消选择
        </button>
        {showBatchDeleteConfirm ? (
          <>
            <button
              onClick={() => void handleBatchDelete()}
              className="whitespace-nowrap rounded-xl bg-red-500 px-3 py-1 text-[13px] text-white hover:bg-red-600"
            >
              确认删除
            </button>
            <button
              onClick={() => setShowBatchDeleteConfirm(false)}
              className="whitespace-nowrap rounded-xl bg-gray-100 px-3 py-1 text-[13px] text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowBatchDeleteConfirm(true)}
            className="whitespace-nowrap rounded-xl bg-red-500 px-3 py-1 text-[13px] text-white hover:bg-red-600"
          >
            批量删除
          </button>
        )}
      </div>
    </div>
  );
}
