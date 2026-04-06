import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ArrowUpDown, Filter, Play } from "lucide-react"
import { useFileStore, FileItem, getNameWithoutExt } from "@/stores/fileStore"
import { useFilterStore, type FileSortField, type SortDirection } from "@/stores/filterStore"
import { clampLibraryViewScale, DEFAULT_LIBRARY_VIEW_SCALES, getLibraryViewScaleRange, LIBRARY_VIEW_SCALE_STEP, type LibraryViewMode, type LibraryVisibleField, useSettingsStore } from "@/stores/settingsStore"
import { startExternalFileDrag } from "@/lib/externalDrag"
import { cn } from "@/lib/utils"
import { REQUEST_FOCUS_FIRST_FILE_EVENT } from "@/lib/libraryNavigation"
import FileTypeIcon from "./FileTypeIcon"
import { canGenerateThumbnail, getImageSrc, getThumbnailImageSrc, getVideoThumbnailSrc, isImageFile, isVideoFile, formatSize } from "@/utils"
import FileContextMenu from "./FileContextMenu"
import { toast } from "sonner"

const TILE_CARD_BASE_WIDTH = 180
const TILE_CARD_MIN_WIDTH = 90
const TILE_CARD_MAX_WIDTH = 420
const GRID_GAP = 16
const GRID_PREVIEW_HEIGHT_RATIO = 0.6
const LIST_BASE_ROW_HEIGHT = 56
const LIST_BASE_THUMBNAIL_SIZE = 40
const OBSERVER_ROOT_MARGIN = "300px"
const GRID_METADATA_HEIGHT = 56
const GRID_METADATA_HEIGHT_WITH_TAGS = 72
const ADAPTIVE_CARD_FOOTER_HEIGHT = 44
const ADAPTIVE_CARD_FOOTER_WITH_TAGS_HEIGHT = 62
const VIEWPORT_OVERSCAN_PX = 600
const IMAGE_SRC_CACHE_LIMIT = 300
const INTERNAL_FILE_DRAG_MIME = "application/x-shiguang-file-ids"
const SELECTION_DRAG_THRESHOLD = 10
const MAX_VISIBLE_TAGS = 3
const LIST_MAX_VISIBLE_TAGS = 2
const VIEW_SCALE_KEYBOARD_STEP = 0.1
const VIEW_SCALE_WHEEL_SENSITIVITY = 0.0012
const SORT_DIRECTION_OPTIONS: Array<{ value: SortDirection; label: string }> = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" },
]

const SORT_FIELD_OPTIONS: Array<{ value: FileSortField; label: string }> = [
  { value: "imported_at", label: "导入时间" },
  { value: "created_at", label: "创建时间" },
  { value: "modified_at", label: "修改时间" },
  { value: "name", label: "名称" },
  { value: "ext", label: "类型" },
  { value: "size", label: "文件大小" },
]

const VIEW_MODE_OPTIONS: Array<{ value: LibraryViewMode; label: string }> = [
  { value: "grid", label: "网格" },
  { value: "adaptive", label: "自适应" },
  { value: "list", label: "列表" },
]

const INFO_FIELD_OPTIONS: Array<{ value: LibraryVisibleField; label: string }> = [
  { value: "name", label: "名称" },
  { value: "ext", label: "类型" },
  { value: "size", label: "文件大小" },
  { value: "dimensions", label: "尺寸" },
  { value: "tags", label: "标签" },
]

type SelectionBox = {
  startX: number
  startY: number
  endX: number
  endY: number
}

type ArrowNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
type ToolbarMenu = "sort" | "layout" | "info"

const TOOLBAR_BUTTON_CLASS_NAME =
  "relative inline-flex h-8 w-8 items-center justify-center rounded-md border text-gray-500 transition-colors"

function getToolbarButtonClassName(isActive: boolean) {
  return cn(
    TOOLBAR_BUTTON_CLASS_NAME,
    isActive
      ? "border-gray-300 bg-gray-200 text-gray-800 dark:border-gray-600 dark:bg-dark-border dark:text-gray-100"
      : "border-gray-200/80 bg-white/70 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-700 dark:border-dark-border dark:bg-dark-bg/80 dark:hover:bg-dark-border dark:hover:text-gray-200",
  )
}

const imageSrcCache = new Map<string, string>()

function getCachedImageSrc(cacheKey: string) {
  const cached = imageSrcCache.get(cacheKey)
  if (!cached) {
    return null
  }

  imageSrcCache.delete(cacheKey)
  imageSrcCache.set(cacheKey, cached)
  return cached
}

function cacheImageSrc(cacheKey: string, src: string) {
  if (!src) {
    return
  }

  const existing = imageSrcCache.get(cacheKey)
  if (existing && existing !== src && existing.startsWith("blob:")) {
    URL.revokeObjectURL(existing)
  }

  imageSrcCache.set(cacheKey, src)

  while (imageSrcCache.size > IMAGE_SRC_CACHE_LIMIT) {
    const oldestKey = imageSrcCache.keys().next().value
    if (!oldestKey) {
      break
    }

    const oldestSrc = imageSrcCache.get(oldestKey)
    if (oldestSrc?.startsWith("blob:")) {
      URL.revokeObjectURL(oldestSrc)
    }
    imageSrcCache.delete(oldestKey)
  }
}

function getPointerPositionInScrollContainer(clientX: number, clientY: number, container: HTMLDivElement) {
  const rect = container.getBoundingClientRect()

  return {
    x: clientX - rect.left + container.scrollLeft,
    y: clientY - rect.top + container.scrollTop,
  }
}

function getSelectionBounds(selectionBox: SelectionBox) {
  const minX = Math.min(selectionBox.startX, selectionBox.endX)
  const maxX = Math.max(selectionBox.startX, selectionBox.endX)
  const minY = Math.min(selectionBox.startY, selectionBox.endY)
  const maxY = Math.max(selectionBox.startY, selectionBox.endY)

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function isCardIntersectingSelection(cardRect: DOMRect, containerRect: DOMRect, container: HTMLDivElement, bounds: ReturnType<typeof getSelectionBounds>) {
  const cardLeft = cardRect.left - containerRect.left + container.scrollLeft
  const cardTop = cardRect.top - containerRect.top + container.scrollTop
  const cardRight = cardLeft + cardRect.width
  const cardBottom = cardTop + cardRect.height

  return (
    cardLeft <= bounds.maxX &&
    cardRight >= bounds.minX &&
    cardTop <= bounds.maxY &&
    cardBottom >= bounds.minY
  )
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"))
}

function isDialogTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("[role='dialog'], [role='menu']"))
}

function getGridMetadataHeight(scale: number, visibleFields: LibraryVisibleField[]) {
  const showsTags = visibleFields.includes("tags")
  const baseHeight = showsTags ? GRID_METADATA_HEIGHT_WITH_TAGS : GRID_METADATA_HEIGHT
  const minHeight = showsTags ? 62 : 48
  return Math.max(minHeight, Math.round(baseHeight * (0.88 + scale * 0.1)))
}

export default function FileGrid() {
  const {
    files,
    selectedFile,
    setSelectedFile,
    isLoading,
    selectedFiles,
    clearSelection,
    deleteFiles,
    openPreview,
    pagination,
    runCurrentQuery,
    setPage,
    setPageSize,
  } = useFileStore()
  const isFilterPanelOpen = useFilterStore((state) => state.isFilterPanelOpen)
  const toggleFilterPanel = useFilterStore((state) => state.toggleFilterPanel)
  const activeFilterCount = useFilterStore((state) => {
    let count = 0
    if (state.criteria.fileType !== "all") count += 1
    if (state.criteria.tagIds.length > 0) count += 1
    if (state.criteria.dominantColor) count += 1
    return count
  })
  const sortBy = useFilterStore((state) => state.criteria.sortBy)
  const sortDirection = useFilterStore((state) => state.criteria.sortDirection)
  const setSortBy = useFilterStore((state) => state.setSortBy)
  const setSortDirection = useFilterStore((state) => state.setSortDirection)
  const viewMode = useSettingsStore((state) => state.libraryViewMode)
  const libraryViewScales = useSettingsStore((state) => state.libraryViewScales)
  const libraryVisibleFields = useSettingsStore((state) => state.libraryVisibleFields)
  const setLibraryViewMode = useSettingsStore((state) => state.setLibraryViewMode)
  const setLibraryViewScale = useSettingsStore((state) => state.setLibraryViewScale)
  const resetLibraryViewScale = useSettingsStore((state) => state.resetLibraryViewScale)
  const toggleLibraryVisibleField = useSettingsStore((state) => state.toggleLibraryVisibleField)
  const filteredFiles = files
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null)
  const [openToolbarMenu, setOpenToolbarMenu] = useState<ToolbarMenu | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const scrollParentRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const sortMenuButtonRef = useRef<HTMLButtonElement>(null)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const layoutMenuButtonRef = useRef<HTMLButtonElement>(null)
  const infoMenuRef = useRef<HTMLDivElement>(null)
  const infoMenuButtonRef = useRef<HTMLButtonElement>(null)
  const currentViewScaleRef = useRef(viewMode === "list" ? libraryViewScales.list : libraryViewScales.grid)
  const wheelScaleRemainderRef = useRef(0)
  const sortDidMountRef = useRef(false)

  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const selectionBoxRef = useRef<SelectionBox | null>(null)
  const tileViewScale = libraryViewScales.grid
  const gridViewScale = tileViewScale
  const listViewScale = libraryViewScales.list
  const currentViewScale = viewMode === "list" ? listViewScale : tileViewScale
  const currentViewScaleRange = getLibraryViewScaleRange(viewMode)
  const currentSortFieldLabel =
    SORT_FIELD_OPTIONS.find((option) => option.value === sortBy)?.label ?? "导入时间"
  const currentSortDirectionLabel = sortDirection === "asc" ? "升序" : "降序"
  const currentViewModeLabel =
    VIEW_MODE_OPTIONS.find((option) => option.value === viewMode)?.label ?? "网格"
  const visibleInfoFieldLabels = INFO_FIELD_OPTIONS
    .filter((option) => libraryVisibleFields.includes(option.value))
    .map((option) => option.label)

  useEffect(() => {
    selectionBoxRef.current = selectionBox
  }, [selectionBox])

  useEffect(() => {
    currentViewScaleRef.current = currentViewScale
  }, [currentViewScale])

  useEffect(() => {
    wheelScaleRemainderRef.current = 0
  }, [viewMode])

  useEffect(() => {
    if (!sortDidMountRef.current) {
      sortDidMountRef.current = true
      return
    }

    useFileStore.setState((state) => ({
      pagination: {
        ...state.pagination,
        page: 1,
      },
    }))
    void runCurrentQuery()
  }, [runCurrentQuery, sortBy, sortDirection])

  useEffect(() => {
    if (!openToolbarMenu) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      const activeMenuRef =
        openToolbarMenu === "sort"
          ? sortMenuRef
          : openToolbarMenu === "layout"
            ? layoutMenuRef
            : infoMenuRef
      const activeButtonRef =
        openToolbarMenu === "sort"
          ? sortMenuButtonRef
          : openToolbarMenu === "layout"
            ? layoutMenuButtonRef
            : infoMenuButtonRef

      if (activeMenuRef.current?.contains(target) || activeButtonRef.current?.contains(target)) {
        return
      }

      setOpenToolbarMenu(null)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenToolbarMenu(null)
      }
    }

    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("keydown", handleEscape)

    return () => {
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [openToolbarMenu])

  useEffect(() => {
    const element = scrollParentRef.current
    if (!element) return

    const updateWidth = () => {
      const styles = window.getComputedStyle(element)
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft || "0") +
        Number.parseFloat(styles.paddingRight || "0")
      const verticalPadding =
        Number.parseFloat(styles.paddingTop || "0") +
        Number.parseFloat(styles.paddingBottom || "0")

      setContainerWidth(Math.max(0, element.clientWidth - horizontalPadding))
      setViewportHeight(Math.max(0, element.clientHeight - verticalPadding))
      setScrollTop(element.scrollTop)
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)

    const handleScroll = () => {
      setScrollTop(element.scrollTop)
    }

    element.addEventListener("scroll", handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      element.removeEventListener("scroll", handleScroll)
    }
  }, [isLoading, files.length])

  const tileTargetWidth = Math.max(
    TILE_CARD_MIN_WIDTH,
    Math.min(TILE_CARD_MAX_WIDTH, Math.round(TILE_CARD_BASE_WIDTH * tileViewScale)),
  )
  const gridMinWidth = tileTargetWidth
  const gridMetadataHeight = getGridMetadataHeight(gridViewScale, libraryVisibleFields)
  const listRowHeight = Math.max(42, Math.round(LIST_BASE_ROW_HEIGHT * listViewScale))
  const listThumbnailSize = Math.max(28, Math.round(LIST_BASE_THUMBNAIL_SIZE * listViewScale))
  const adaptiveTargetWidth = tileTargetWidth
  const contentWidth = Math.max(containerWidth, gridMinWidth)
  const gridColumns = Math.max(1, Math.floor((contentWidth + GRID_GAP) / (gridMinWidth + GRID_GAP)))
  const gridItemWidth = Math.min(
    gridMinWidth,
    Math.max(0, Math.floor((contentWidth - GRID_GAP * (gridColumns - 1)) / gridColumns)),
  )
  const gridTrackWidth = gridColumns * gridItemWidth + GRID_GAP * Math.max(0, gridColumns - 1)
  const gridPreviewHeight = Math.ceil(gridItemWidth * GRID_PREVIEW_HEIGHT_RATIO)
  const gridRowHeight = gridPreviewHeight + gridMetadataHeight
  const gridRowSpan = gridRowHeight + GRID_GAP
  const gridRowCount = Math.ceil(filteredFiles.length / gridColumns)
  const gridVisibleStartRow = Math.max(0, Math.floor((scrollTop - VIEWPORT_OVERSCAN_PX) / Math.max(gridRowSpan, 1)))
  const gridVisibleEndRow = Math.min(
    Math.max(0, gridRowCount - 1),
    Math.ceil((scrollTop + viewportHeight + VIEWPORT_OVERSCAN_PX) / Math.max(gridRowSpan, 1)),
  )
  const gridVirtualRows =
    gridRowCount > 0
      ? Array.from(
          { length: Math.max(0, gridVisibleEndRow - gridVisibleStartRow + 1) },
          (_, idx) => gridVisibleStartRow + idx,
        )
      : []
  const adaptiveColumns = Math.max(
    1,
    Math.min(
      Math.max(1, Math.floor((Math.max(containerWidth, adaptiveTargetWidth) + GRID_GAP) / (adaptiveTargetWidth + GRID_GAP))),
      Math.max(1, filteredFiles.length),
    ),
  )
  const adaptiveAvailableColumnWidth = Math.max(
    0,
    Math.floor((Math.max(containerWidth, adaptiveTargetWidth) - GRID_GAP * (adaptiveColumns - 1)) / adaptiveColumns),
  )
  const adaptiveColumnWidth = Math.min(adaptiveTargetWidth, adaptiveAvailableColumnWidth)
  const adaptiveLayout = buildAdaptiveLayout(filteredFiles, adaptiveColumns, adaptiveColumnWidth, libraryVisibleFields)
  const adaptiveColumnsData = buildAdaptiveColumns(adaptiveLayout.items, adaptiveColumns)

  const listRowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => listRowHeight,
    overscan: 8,
  })

  useEffect(() => {
    listRowVirtualizer.measure()
  }, [listRowHeight, listRowVirtualizer])

  const handleViewModeChange = (nextViewMode: LibraryViewMode) => {
    wheelScaleRemainderRef.current = 0
    setLibraryViewMode(nextViewMode)
    setOpenToolbarMenu(null)
  }

  const applyCurrentViewScale = (nextScale: number) => {
    const normalizedScale = clampLibraryViewScale(viewMode, nextScale)
    wheelScaleRemainderRef.current = 0
    currentViewScaleRef.current = normalizedScale
    setLibraryViewScale(viewMode, normalizedScale)
  }

  const stepCurrentViewScale = (direction: 1 | -1) => {
    applyCurrentViewScale(currentViewScaleRef.current + direction * VIEW_SCALE_KEYBOARD_STEP)
  }

  const resetCurrentViewScale = () => {
    wheelScaleRemainderRef.current = 0
    currentViewScaleRef.current = DEFAULT_LIBRARY_VIEW_SCALES[viewMode]
    resetLibraryViewScale(viewMode)
  }

  const toggleToolbarMenu = (menu: ToolbarMenu) => {
    setOpenToolbarMenu((currentMenu) => (currentMenu === menu ? null : menu))
  }

  const handleViewportWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || isSelecting) {
      return
    }

    if (isEditableTarget(event.target) || isDialogTarget(event.target)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    wheelScaleRemainderRef.current += -event.deltaY * VIEW_SCALE_WHEEL_SENSITIVITY
    const wholeSteps = Math.trunc(Math.abs(wheelScaleRemainderRef.current) / LIBRARY_VIEW_SCALE_STEP)

    if (wholeSteps === 0) {
      return
    }

    const delta = Math.sign(wheelScaleRemainderRef.current) * wholeSteps * LIBRARY_VIEW_SCALE_STEP
    wheelScaleRemainderRef.current -= delta

    const nextScale = clampLibraryViewScale(viewMode, currentViewScaleRef.current + delta)
    currentViewScaleRef.current = nextScale
    setLibraryViewScale(viewMode, nextScale)
  }

  const handleFileClick = (file: FileItem, event: ReactMouseEvent<HTMLDivElement>) => {
    scrollParentRef.current?.focus({ preventScroll: true })

    if (event.ctrlKey || event.metaKey) {
      const nextSelectedIds = new Set<number>(selectedFiles)

      // Promote the current single selection into the multi-selection set.
      if (selectedFile) {
        nextSelectedIds.add(selectedFile.id)
      }

      if (nextSelectedIds.has(file.id)) {
        nextSelectedIds.delete(file.id)
      } else {
        nextSelectedIds.add(file.id)
      }

      useFileStore.setState({
        selectedFiles: Array.from(nextSelectedIds),
        selectedFile: null,
      })
      return
    }

    if (selectedFiles.length > 0) {
      clearSelection()
    }

    setSelectedFile(file)
  }

  const handleFileDoubleClick = (index: number) => {
    openPreview(index, filteredFiles)
  }

  const handleSelectionStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const target = event.target as HTMLElement
    if (target.closest(".file-card")) {
      return
    }

    const container = scrollParentRef.current
    if (!container) {
      return
    }

    container.focus({ preventScroll: true })

    if (selectedFiles.length > 0) {
      clearSelection()
    }
    if (selectedFile) {
      setSelectedFile(null)
    }

    setIsSelecting(true)
    const startPoint = getPointerPositionInScrollContainer(event.clientX, event.clientY, container)

    setSelectionBox({
      startX: startPoint.x,
      startY: startPoint.y,
      endX: startPoint.x,
      endY: startPoint.y,
    })
  }

  useEffect(() => {
    if (!isSelecting) {
      return
    }

    const handleWindowMouseMove = (event: MouseEvent) => {
      const container = scrollParentRef.current
      if (!container) {
        return
      }

      setSelectionBox((current) => {
        if (!current) {
          return current
        }

        const point = getPointerPositionInScrollContainer(event.clientX, event.clientY, container)
        return {
          ...current,
          endX: point.x,
          endY: point.y,
        }
      })
    }

    const handleWindowMouseUp = () => {
      const container = scrollParentRef.current
      const currentSelectionBox = selectionBoxRef.current

      if (container && currentSelectionBox) {
        const bounds = getSelectionBounds(currentSelectionBox)

        if (Math.max(bounds.width, bounds.height) > SELECTION_DRAG_THRESHOLD) {
          const containerRect = container.getBoundingClientRect()
          const nextSelectedFiles = Array.from(container.querySelectorAll(".file-card"))
            .map((card) => {
              if (!isCardIntersectingSelection(card.getBoundingClientRect(), containerRect, container, bounds)) {
                return null
              }

              const fileId = Number(card.getAttribute("data-file-id") || "0")
              return fileId > 0 ? fileId : null
            })
            .filter((fileId): fileId is number => fileId !== null)

          useFileStore.setState({
            selectedFiles: nextSelectedFiles,
            selectedFile: null,
          })
        }
      }

      selectionBoxRef.current = null
      setIsSelecting(false)
      setSelectionBox(null)
    }

    window.addEventListener("mousemove", handleWindowMouseMove)
    window.addEventListener("mouseup", handleWindowMouseUp)

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
    }
  }, [isSelecting])

  const scrollIndexIntoView = useCallback((index: number) => {
    const container = scrollParentRef.current
    if (!container) {
      return
    }

    let itemTop = 0
    let itemBottom = 0

    if (viewMode === "list") {
      itemTop = index * listRowHeight
      itemBottom = itemTop + listRowHeight
    } else if (viewMode === "grid") {
      const row = Math.floor(index / gridColumns)
      itemTop = row * gridRowSpan
      itemBottom = itemTop + gridRowHeight
    } else {
      const item = adaptiveLayout.items[index]
      if (!item) {
        return
      }
      itemTop = item.top
      itemBottom = item.top + item.height
    }

    const padding = 24
    const viewportTop = container.scrollTop
    const viewportBottom = viewportTop + container.clientHeight

    if (itemTop < viewportTop + padding) {
      container.scrollTo({ top: Math.max(0, itemTop - padding) })
      return
    }

    if (itemBottom > viewportBottom - padding) {
      container.scrollTo({ top: Math.max(0, itemBottom - container.clientHeight + padding) })
    }
  }, [adaptiveLayout.items, gridColumns, gridRowHeight, gridRowSpan, listRowHeight, viewMode])

  const focusGridContainer = useCallback(() => {
    scrollParentRef.current?.focus({ preventScroll: true })
  }, [])

  const selectFileAtIndex = useCallback((index: number) => {
    const nextFile = filteredFiles[index]
    focusGridContainer()

    if (!nextFile) {
      return
    }

    if (selectedFiles.length > 0) {
      clearSelection()
    }

    setSelectedFile(nextFile)
    scrollIndexIntoView(index)
  }, [clearSelection, filteredFiles, focusGridContainer, scrollIndexIntoView, selectedFiles.length, setSelectedFile])

  useEffect(() => {
    const handleRequestFocusFirstFile = () => {
      focusGridContainer()
      if (filteredFiles.length === 0) {
        return
      }

      selectFileAtIndex(0)
    }

    window.addEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile)
    return () => {
      window.removeEventListener(REQUEST_FOCUS_FIRST_FILE_EVENT, handleRequestFocusFirstFile)
    }
  }, [filteredFiles.length, focusGridContainer, selectFileAtIndex])

  useEffect(() => {
    const handleWindowZoomKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        isSelecting
      ) {
        return
      }

      if (isEditableTarget(event.target) || isDialogTarget(event.target)) {
        return
      }

      let handled = true

      switch (event.key) {
        case "+":
        case "=":
        case "NumpadAdd":
          stepCurrentViewScale(1)
          break
        case "-":
        case "_":
        case "NumpadSubtract":
          stepCurrentViewScale(-1)
          break
        case "0":
        case "Numpad0":
          resetCurrentViewScale()
          break
        default:
          handled = false
          break
      }

      if (!handled) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("keydown", handleWindowZoomKeyDown)
    return () => {
      window.removeEventListener("keydown", handleWindowZoomKeyDown)
    }
  }, [isSelecting, resetCurrentViewScale, stepCurrentViewScale])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isSelecting ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      if (
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown" &&
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return
      }

      if (isEditableTarget(event.target) || isDialogTarget(event.target) || selectedFiles.length > 0 || filteredFiles.length === 0) {
        return
      }

      event.preventDefault()

      const currentIndex = selectedFile ? filteredFiles.findIndex((file) => file.id === selectedFile.id) : -1
      let nextIndex = currentIndex

      if (currentIndex === -1) {
        nextIndex = event.key === "ArrowLeft" || event.key === "ArrowUp" ? filteredFiles.length - 1 : 0
      } else if (viewMode === "list") {
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          nextIndex = Math.max(0, currentIndex - 1)
        } else {
          nextIndex = Math.min(filteredFiles.length - 1, currentIndex + 1)
        }
      } else if (viewMode === "grid") {
        const row = Math.floor(currentIndex / gridColumns)
        const col = currentIndex % gridColumns

        switch (event.key) {
          case "ArrowLeft":
            nextIndex = Math.max(0, currentIndex - 1)
            break
          case "ArrowRight":
            nextIndex = Math.min(filteredFiles.length - 1, currentIndex + 1)
            break
          case "ArrowUp":
            if (row === 0) {
              return
            }
            nextIndex = (row - 1) * gridColumns + col
            break
          case "ArrowDown": {
            const nextRowStart = (row + 1) * gridColumns
            if (nextRowStart >= filteredFiles.length) {
              return
            }
            nextIndex = Math.min(nextRowStart + col, filteredFiles.length - 1)
            break
          }
        }
      } else {
        nextIndex = findAdaptiveNeighborIndex(adaptiveLayout.items, currentIndex, event.key)
      }

      if (nextIndex === currentIndex || nextIndex < 0 || nextIndex >= filteredFiles.length) {
        return
      }

      selectFileAtIndex(nextIndex)
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown)
    }
  }, [
    adaptiveLayout.items,
    filteredFiles,
    gridColumns,
    gridRowHeight,
    isSelecting,
    listRowHeight,
    selectedFile,
    selectedFiles.length,
    selectFileAtIndex,
    viewMode,
  ])

  const handleBatchDelete = async () => {
    await deleteFiles(selectedFiles)
    setShowBatchDeleteConfirm(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-dark-border">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} / ` : ""}
            {filteredFiles.length} 个文件
            {pagination.totalPages > 1 && ` (第 ${pagination.page}/${pagination.totalPages} 页)`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setOpenToolbarMenu(null)
              toggleFilterPanel()
            }}
            className={getToolbarButtonClassName(isFilterPanelOpen)}
            title={activeFilterCount > 0 ? `筛选：已启用 ${activeFilterCount} 项` : "筛选"}
            aria-label="筛选"
            aria-pressed={isFilterPanelOpen}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-medium leading-none text-white">
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
                className="absolute right-0 top-10 z-30 w-52 rounded-xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                  排序方式
                </div>
                {SORT_DIRECTION_OPTIONS.map((option) => {
                  const isActive = sortDirection === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortDirection(option.value)
                        setOpenToolbarMenu(null)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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
                  )
                })}

                <div className="my-1.5 h-px bg-gray-100 dark:bg-dark-border" />

                <div className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                  排序依据
                </div>
                {SORT_FIELD_OPTIONS.map((option) => {
                  const isActive = sortBy === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSortBy(option.value)
                        setOpenToolbarMenu(null)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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
                  )
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
                className="absolute right-0 top-10 z-30 w-52 rounded-xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                  信息显示
                </div>
                {INFO_FIELD_OPTIONS.map((option) => {
                  const isActive = libraryVisibleFields.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleLibraryVisibleField(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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
                  )
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
                className="absolute right-0 top-10 z-30 w-44 rounded-xl border border-gray-200 bg-white/98 p-1.5 shadow-2xl backdrop-blur dark:border-dark-border dark:bg-dark-surface/98"
              >
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">
                  布局
                </div>
                {VIEW_MODE_OPTIONS.map((option) => {
                  const isActive = viewMode === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleViewModeChange(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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
                  )
                })}
              </div>
            )}
          </div>
          <div
            className="hidden items-center sm:flex"
            onDoubleClick={resetCurrentViewScale}
          >
            <input
              type="range"
              min={currentViewScaleRange.min}
              max={currentViewScaleRange.max}
              step={LIBRARY_VIEW_SCALE_STEP}
              value={currentViewScale}
              onChange={(event) => applyCurrentViewScale(Number(event.target.value))}
              className="h-1 w-16 cursor-pointer accent-gray-400 opacity-75 transition-opacity hover:opacity-100 dark:accent-gray-500"
              aria-label="当前视图缩放"
            />
          </div>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-gray-500 dark:text-gray-400">
          <svg className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-lg font-medium">暂无文件</p>
          <p className="mt-1 text-sm">当前目录下暂无文件</p>
        </div>
      ) : (
        <div
          ref={scrollParentRef}
          className="relative flex-1 overflow-auto p-4 select-none focus:outline-none"
          tabIndex={0}
          onMouseDown={handleSelectionStart}
          onWheel={handleViewportWheel}
        >
          {viewMode === "adaptive" ? (
            <div
              className="flex items-start gap-4"
              style={{
                width: `${adaptiveLayout.trackWidth}px`,
                maxWidth: "100%",
              }}
            >
              {adaptiveColumnsData.filter((column) => column.length > 0).map((column, columnIndex) => (
                <div
                  key={`adaptive-column-${columnIndex}`}
                  className="flex min-w-0 flex-col gap-4"
                  style={{ width: `${adaptiveLayout.columnWidth}px`, flex: "0 0 auto" }}
                >
                  {column.map(({ file, index, width }) => (
                    <div
                      key={`adaptive-${index}`}
                      className="mx-auto w-full"
                      style={{ maxWidth: `${width}px` }}
                    >
                      <AdaptiveFileCard
                        file={file}
                        visibleFields={libraryVisibleFields}
                        isSelected={selectedFile?.id === file.id}
                        isMultiSelected={selectedFiles.includes(file.id)}
                        isDragging={draggingFileId === file.id}
                        scrollRootRef={scrollParentRef}
                        onClick={(e) => handleFileClick(file, e)}
                        onDoubleClick={() => handleFileDoubleClick(index)}
                        onDragStart={() => setDraggingFileId(file.id)}
                        onDragEnd={() => setDraggingFileId(null)}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : viewMode === "grid" ? (
            <div
              className="relative"
              style={{ height: `${Math.max(0, gridRowCount * gridRowSpan - GRID_GAP)}px` }}
            >
              {gridVirtualRows.map((rowIndex) => {
                const startIndex = rowIndex * gridColumns
                const rowFiles = filteredFiles.slice(startIndex, startIndex + gridColumns)

                return (
                  <div
                    key={rowIndex}
                    className="absolute left-0 top-0"
                    style={{
                      width: `${gridTrackWidth}px`,
                      height: `${gridRowHeight}px`,
                      transform: `translateY(${rowIndex * gridRowSpan}px)`,
                    }}
                  >
                    <div
                      className="grid gap-4"
                      style={{ gridTemplateColumns: `repeat(${gridColumns}, ${gridItemWidth}px)` }}
                    >
                      {rowFiles.map((file, offset) => (
                        <FileCard
                          key={`grid-${rowIndex}-${offset}`}
                          file={file}
                          footerHeight={gridMetadataHeight}
                          visibleFields={libraryVisibleFields}
                          isSelected={selectedFile?.id === file.id}
                          isMultiSelected={selectedFiles.includes(file.id)}
                          isDragging={draggingFileId === file.id}
                          scrollRootRef={scrollParentRef}
                          onClick={(e) => handleFileClick(file, e)}
                          onDoubleClick={() => handleFileDoubleClick(startIndex + offset)}
                          onDragStart={() => setDraggingFileId(file.id)}
                          onDragEnd={() => setDraggingFileId(null)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="relative" style={{ height: `${listRowVirtualizer.getTotalSize()}px` }}>
              {listRowVirtualizer.getVirtualItems().map((virtualRow) => {
                const file = filteredFiles[virtualRow.index]
                if (!file) return null

                return (
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 top-0 w-full"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <FileRow
                      file={file}
                      thumbnailSize={listThumbnailSize}
                      visibleFields={libraryVisibleFields}
                      isSelected={selectedFile?.id === file.id}
                      isMultiSelected={selectedFiles.includes(file.id)}
                      isDragging={draggingFileId === file.id}
                      scrollRootRef={scrollParentRef}
                      onClick={(e) => handleFileClick(file, e)}
                      onDoubleClick={() => handleFileDoubleClick(virtualRow.index)}
                      onDragStart={() => setDraggingFileId(file.id)}
                      onDragEnd={() => setDraggingFileId(null)}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {selectionBox && (
            <div
              className="pointer-events-none absolute border-2 border-primary-500 bg-primary-500/10"
              style={{
                left: Math.min(selectionBox.startX, selectionBox.endX),
                top: Math.min(selectionBox.startY, selectionBox.endY),
                width: Math.abs(selectionBox.endX - selectionBox.startX),
                height: Math.abs(selectionBox.endY - selectionBox.startY),
              }}
            />
          )}

        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 border-t border-gray-200 py-2 dark:border-dark-border">
          <button
            onClick={() => setPage(1)}
            disabled={pagination.page <= 1}
            className="rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
          >
            首页
          </button>
          <button
            onClick={() => setPage(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
          >
            上一页
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            第 {pagination.page} / {pagination.totalPages} 页
          </span>
          <button
            onClick={() => setPage(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
          >
            下一页
          </button>
          <button
            onClick={() => setPage(pagination.totalPages)}
            disabled={pagination.page >= pagination.totalPages}
            className="rounded px-2 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-border"
          >
            末页
          </button>
          <select
            value={pagination.pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="ml-2 rounded border px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-dark-border"
          >
            <option value={50}>50/页</option>
            <option value={100}>100/页</option>
            <option value={200}>200/页</option>
            <option value={500}>500/页</option>
          </select>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 transform flex-wrap items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-lg dark:border-dark-border dark:bg-dark-surface">
          <span className="whitespace-nowrap text-sm text-gray-700 dark:text-gray-200">已选择 {selectedFiles.length} 个文件</span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => clearSelection()}
              className="whitespace-nowrap rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              取消选择
            </button>
            {showBatchDeleteConfirm ? (
              <>
                <button
                  onClick={handleBatchDelete}
                  className="whitespace-nowrap rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
                >
                  确认删除
                </button>
                <button
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  className="whitespace-nowrap rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                className="whitespace-nowrap rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600"
              >
                批量删除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

type AdaptiveLayoutItem = {
  file: FileItem
  index: number
  columnIndex: number
  left: number
  top: number
  width: number
  height: number
}

function findAdaptiveNeighborIndex(items: AdaptiveLayoutItem[], currentIndex: number, direction: ArrowNavigationKey) {
  const currentItem = items[currentIndex]
  if (!currentItem) {
    return currentIndex
  }

  const currentLeft = currentItem.left
  const currentRight = currentItem.left + currentItem.width
  const currentTop = currentItem.top
  const currentBottom = currentItem.top + currentItem.height
  const currentCenterX = currentItem.left + currentItem.width / 2
  const currentCenterY = currentItem.top + currentItem.height / 2
  let bestIndex = currentIndex
  let bestRank: [number, number, number, number] | null = null

  const compareRank = (nextRank: [number, number, number, number]) => {
    if (!bestRank) {
      return true
    }

    for (let index = 0; index < nextRank.length; index += 1) {
      if (nextRank[index] < bestRank[index]) {
        return true
      }
      if (nextRank[index] > bestRank[index]) {
        return false
      }
    }

    return false
  }

  items.forEach((item, index) => {
    if (index === currentIndex) {
      return
    }

    const candidateCenterX = item.left + item.width / 2
    const candidateCenterY = item.top + item.height / 2
    const deltaX = candidateCenterX - currentCenterX
    const deltaY = candidateCenterY - currentCenterY
    const candidateLeft = item.left
    const candidateRight = item.left + item.width
    const candidateTop = item.top
    const candidateBottom = item.top + item.height

    switch (direction) {
      case "ArrowUp": {
        if (deltaY >= -4) {
          return
        }
        const overlap = Math.max(0, Math.min(currentRight, candidateRight) - Math.max(currentLeft, candidateLeft))
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, currentTop - candidateBottom),
          Math.abs(deltaX),
          Math.abs(deltaY),
        ]
        if (compareRank(rank)) {
          bestIndex = index
          bestRank = rank
        }
        break
      }
      case "ArrowDown": {
        if (deltaY <= 4) {
          return
        }
        const overlap = Math.max(0, Math.min(currentRight, candidateRight) - Math.max(currentLeft, candidateLeft))
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, candidateTop - currentBottom),
          Math.abs(deltaX),
          Math.abs(deltaY),
        ]
        if (compareRank(rank)) {
          bestIndex = index
          bestRank = rank
        }
        break
      }
      case "ArrowLeft": {
        if (deltaX >= -4) {
          return
        }
        const overlap = Math.max(0, Math.min(currentBottom, candidateBottom) - Math.max(currentTop, candidateTop))
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, currentLeft - candidateRight),
          Math.abs(deltaY),
          Math.abs(deltaX),
        ]
        if (compareRank(rank)) {
          bestIndex = index
          bestRank = rank
        }
        break
      }
      case "ArrowRight": {
        if (deltaX <= 4) {
          return
        }
        const overlap = Math.max(0, Math.min(currentBottom, candidateBottom) - Math.max(currentTop, candidateTop))
        const rank: [number, number, number, number] = [
          overlap > 0 ? 0 : 1,
          Math.max(0, candidateLeft - currentRight),
          Math.abs(deltaY),
          Math.abs(deltaX),
        ]
        if (compareRank(rank)) {
          bestIndex = index
          bestRank = rank
        }
        break
      }
    }
  })

  return bestIndex
}

function buildAdaptiveLayout(files: FileItem[], columns: number, columnWidth: number, visibleFields: LibraryVisibleField[]) {
  if (files.length === 0 || columnWidth <= 0) {
    return { items: [] as AdaptiveLayoutItem[], totalHeight: 0, columnWidth: 0, trackWidth: 0 }
  }

  const visualWidth = columnWidth
  const horizontalInset = 0
  const heights = Array.from({ length: columns }, () => 0)
  const items: AdaptiveLayoutItem[] = files.map((file, index) => {
    const imageHeight = getAdaptiveImageHeight(file, visualWidth)
    const totalHeight = imageHeight + getAdaptiveFooterHeight(file, visibleFields)
    let columnIndex = 0

    for (let i = 1; i < heights.length; i += 1) {
      if (heights[i] < heights[columnIndex]) {
        columnIndex = i
      }
    }

    const top = heights[columnIndex]
    const left = columnIndex * (columnWidth + GRID_GAP) + horizontalInset
    heights[columnIndex] += totalHeight + GRID_GAP

    return {
      file,
      index,
      columnIndex,
      left,
      top,
      width: visualWidth,
      height: totalHeight,
    }
  })

  return {
    items,
    totalHeight: Math.max(0, ...heights) - GRID_GAP,
    columnWidth,
    trackWidth: columnWidth * columns + GRID_GAP * Math.max(0, columns - 1),
  }
}

function buildAdaptiveColumns(items: AdaptiveLayoutItem[], columns: number) {
  const nextColumns = Array.from({ length: Math.max(1, columns) }, () => [] as AdaptiveLayoutItem[])

  items.forEach((item) => {
    const column = nextColumns[item.columnIndex]
    if (column) {
      column.push(item)
    }
  })

  return nextColumns
}

function getAdaptiveImageHeight(file: FileItem, width: number) {
  if (!file.width || !file.height || file.width <= 0 || file.height <= 0) {
    return width
  }

  return Math.max(80, Math.round((file.height / file.width) * width))
}

function getAdaptiveFooterHeight(file: FileItem, visibleFields: LibraryVisibleField[]) {
  return shouldShowTags(file, visibleFields)
    ? ADAPTIVE_CARD_FOOTER_WITH_TAGS_HEIGHT
    : ADAPTIVE_CARD_FOOTER_HEIGHT
}

function useVisibility(rootRef: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    const root = rootRef.current
    if (!element || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries.some((entry) => entry.isIntersecting))
      },
      {
        root,
        rootMargin: OBSERVER_ROOT_MARGIN,
      },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [rootRef])

  return { ref, isVisible }
}

function useLazyImageSrc(path: string, ext: string, cacheKey: string, isVisible: boolean) {
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(() => getCachedImageSrc(cacheKey))

  useEffect(() => {
    if (!isVisible) return

    if (!canGenerateThumbnail(ext)) {
      setImageError(false)
      setImageSrc("")
      return
    }

    const cached = getCachedImageSrc(cacheKey)
    if (cached) {
      setImageError(false)
      setImageSrc(cached)
      return
    }

    let active = true
    setImageError(false)

    const loadSrc = isImageFile(ext)
      ? getThumbnailImageSrc(path, ext).then(async (thumbnailSrc) => thumbnailSrc || await getImageSrc(path))
      : getVideoThumbnailSrc(path)

    loadSrc.then((src) => {
      if (!active) {
        return
      }

      cacheImageSrc(cacheKey, src)
      setImageSrc(src)
    })

    return () => {
      active = false
    }
  }, [cacheKey, ext, isVisible, path])

  return {
    imageSrc,
    imageError,
    setImageError,
  }
}

type FileCardBaseProps = {
  file: FileItem
  visibleFields: LibraryVisibleField[]
  isSelected: boolean
  isMultiSelected: boolean
  isDragging: boolean
  scrollRootRef: RefObject<HTMLDivElement | null>
  onClick: (e: ReactMouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

function FileCard({ file, visibleFields, footerHeight, isSelected, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps & { footerHeight: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const showName = visibleFields.includes("name")
  const metaTokens = getFileInfoTokens(file, visibleFields)
  const showTags = shouldShowTags(file, visibleFields)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    onDragStart()
  }

  const handleNativeDragEnd = () => {
    useFileStore.getState().clearInternalFileDrag()
    onDragEnd()
  }

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef} className="h-full">
        <div
          draggable
          data-file-id={file.id}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onDragStart={handleNativeDragStart}
          onDragEnd={handleNativeDragEnd}
          className={`file-card group relative flex h-full flex-col overflow-hidden rounded-lg transition-all ${isDragging ? "opacity-50" : "cursor-pointer"} ${
            isMultiSelected
              ? "ring-2 ring-primary-500 shadow-lg"
              : isSelected
                ? "ring-2 ring-primary-300 shadow-md shadow-primary-200/50 dark:ring-primary-700 dark:shadow-primary-950/40"
              : "hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"
          }`}
        >
          <div
            className="relative bg-gray-100 dark:bg-dark-bg"
            draggable
            onDragStart={(event) => handleExternalFileDragStart(event, file.id)}
            style={{ paddingBottom: `${GRID_PREVIEW_HEIGHT_RATIO * 100}%` }}
          >
            {!isVisible || imageSrc === null ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-8 w-8 animate-pulse text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => setImageError(true)}
                loading="lazy"
              />
            ) : (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            )}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col bg-white px-2 py-1.5 dark:bg-dark-surface"
            style={{ minHeight: `${footerHeight}px` }}
          >
            {showName && (
              <p className="truncate text-xs leading-4 text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            )}
            {metaTokens.length > 0 && (
              <p className={cn("truncate text-xs leading-4 text-gray-400", showName && "mt-0.5")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-1">
                {file.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                  <span
                    key={tag.id}
                    className="min-w-0 max-w-[88px] truncate rounded-full px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {file.tags.length > MAX_VISIBLE_TAGS && <span className="flex-shrink-0 text-[10px] text-gray-400">+{file.tags.length - MAX_VISIBLE_TAGS}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function AdaptiveFileCard({ file, visibleFields, isSelected, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const footerHeight = getAdaptiveFooterHeight(file, visibleFields)
  const showName = visibleFields.includes("name")
  const metaTokens = getFileInfoTokens(file, visibleFields)
  const showTags = shouldShowTags(file, visibleFields)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    onDragStart()
  }

  const handleNativeDragEnd = () => {
    useFileStore.getState().clearInternalFileDrag()
    onDragEnd()
  }

  const getAspectRatio = () => {
    if (!file.width || !file.height || file.width === 0) {
      return "100%"
    }
    return `${(file.height / file.width) * 100}%`
  }

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef}>
        <div
          draggable
          data-file-id={file.id}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onDragStart={handleNativeDragStart}
          onDragEnd={handleNativeDragEnd}
          className={`file-card group relative flex flex-col overflow-hidden rounded-lg transition-all ${isDragging ? "opacity-50" : "cursor-pointer"} ${
            isMultiSelected
              ? "ring-2 ring-primary-500 shadow-lg"
              : isSelected
                ? "ring-2 ring-primary-300 shadow-md shadow-primary-200/50 dark:ring-primary-700 dark:shadow-primary-950/40"
              : "hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"
          }`}
        >
          <div
            className="relative bg-gray-100 dark:bg-dark-bg"
            draggable
            onDragStart={(event) => handleExternalFileDragStart(event, file.id)}
            style={{ paddingBottom: getAspectRatio() }}
          >
            {!isVisible || imageSrc === null ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-8 w-8 animate-pulse text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => setImageError(true)}
                loading="lazy"
              />
            ) : (
              <FilePreviewFallback ext={file.ext} className="absolute inset-0" />
            )}
            {isVideo && <VideoPlayBadge className="absolute inset-0" />}
          </div>
          <div
            className="flex min-h-0 flex-1 flex-col bg-white px-2 py-1.5 dark:bg-dark-surface"
            style={{ minHeight: `${footerHeight}px` }}
          >
            {showName && (
              <p className="truncate text-xs leading-4 text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            )}
            {metaTokens.length > 0 && (
              <p className={cn("truncate text-xs leading-4 text-gray-400", showName && "mt-0.5")}>
                {metaTokens.join(" · ")}
              </p>
            )}
            {showTags && (
              <div className="mt-auto flex items-center gap-1 overflow-hidden whitespace-nowrap pt-1">
                {file.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
                  <span
                    key={tag.id}
                    className="min-w-0 max-w-[88px] truncate rounded-full px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {file.tags.length > MAX_VISIBLE_TAGS && (
                  <span className="flex-shrink-0 text-[10px] text-gray-400">+{file.tags.length - MAX_VISIBLE_TAGS}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function FileRow({ file, visibleFields, thumbnailSize, isSelected, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps & { thumbnailSize: number }) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const showTags = shouldShowTags(file, visibleFields)
  const visibleTags = showTags ? file.tags.slice(0, LIST_MAX_VISIBLE_TAGS) : []
  const showName = visibleFields.includes("name")
  const metaTokens = getFileInfoTokens(file, visibleFields)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    onDragStart()
  }

  const handleNativeDragEnd = () => {
    useFileStore.getState().clearInternalFileDrag()
    onDragEnd()
  }

  return (
    <FileContextMenu file={file}>
      <div ref={visibilityRef}>
        <div
          draggable
          data-file-id={file.id}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onDragStart={handleNativeDragStart}
          onDragEnd={handleNativeDragEnd}
          className={`file-card flex items-center gap-3 rounded-lg p-2 transition-colors ${isDragging ? "opacity-50" : "cursor-pointer"} ${
            isMultiSelected
              ? "bg-primary-50 dark:bg-primary-900/20"
              : isSelected
                ? "bg-primary-100 dark:bg-primary-900/30 ring-1 ring-inset ring-primary-300 dark:ring-primary-700"
              : "hover:bg-gray-100 dark:hover:bg-dark-border"
          }`}
        >
          <div
            className="relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-dark-bg"
            draggable
            onDragStart={(event) => handleExternalFileDragStart(event, file.id)}
            style={{ height: `${thumbnailSize}px`, width: `${thumbnailSize}px` }}
          >
            {!isVisible || imageSrc === null ? (
              <svg className="h-5 w-5 animate-pulse text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            ) : imageSrc && !imageError ? (
              <img
                src={imageSrc}
                alt={file.name}
                className="max-h-full max-w-full object-contain"
                onError={() => setImageError(true)}
              />
            ) : (
              <FilePreviewFallback ext={file.ext} compact className="h-full w-full" iconClassName="h-5 w-5" labelClassName="text-[9px]" />
            )}
            {isVideo && <VideoPlayBadge compact className="absolute inset-0" />}
          </div>
          <div className="min-w-0 flex-1">
            {showName && (
              <p className="truncate text-sm text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            )}
            <div className={cn("flex items-center gap-1 overflow-hidden text-xs text-gray-400", showName && "mt-0.5")}>
              {metaTokens.map((token, index) => (
                <span key={`${token}-${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="text-gray-300 dark:text-gray-600">·</span>}
                  <span className="truncate">{token}</span>
                </span>
              ))}
              {metaTokens.length > 0 && visibleTags.length > 0 && <span className="text-gray-300 dark:text-gray-600">·</span>}
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex min-w-0 max-w-[84px] items-center gap-1 rounded-full border border-gray-200/80 px-1.5 py-0 text-[10px] text-gray-500 dark:border-gray-700 dark:text-gray-400"
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
              ))}
              {showTags && file.tags.length > LIST_MAX_VISIBLE_TAGS && (
                <span className="flex-shrink-0 text-[10px] text-gray-400">+{file.tags.length - LIST_MAX_VISIBLE_TAGS}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function getFileDimensionsText(file: FileItem) {
  if (file.width > 0 && file.height > 0) {
    return `${file.width} × ${file.height}`
  }

  return null
}

function shouldShowTags(file: FileItem, visibleFields: LibraryVisibleField[]) {
  return visibleFields.includes("tags") && file.tags.length > 0
}

function getFileInfoTokens(file: FileItem, visibleFields: LibraryVisibleField[]) {
  const tokens: string[] = []

  INFO_FIELD_OPTIONS.forEach((option) => {
    if (!visibleFields.includes(option.value)) {
      return
    }

    switch (option.value) {
      case "ext":
        tokens.push(file.ext.toUpperCase())
        break
      case "size":
        tokens.push(formatSize(file.size))
        break
      case "dimensions": {
        const dimensionsText = getFileDimensionsText(file)
        if (dimensionsText) {
          tokens.push(dimensionsText)
        }
        break
      }
      default:
        break
    }
  })

  return tokens
}

function getExternalDragFileIds(fileId: number) {
  const { selectedFiles } = useFileStore.getState()
  return selectedFiles.includes(fileId) ? selectedFiles : [fileId]
}

function handleExternalFileDragStart(event: DragEvent<HTMLElement>, fileId: number) {
  event.preventDefault()
  event.stopPropagation()

  void startExternalFileDrag(getExternalDragFileIds(fileId)).catch((error) => {
    console.error("Failed to start external file drag:", error)
    toast.error("拖拽到外部应用失败")
  })
}

function InfoDisplayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 7h12M10 12h8M10 17h8" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6.5 6.5h.01v.01H6.5zM6.5 11.5h.01v.01H6.5zM6.5 16.5h.01v.01H6.5z" />
    </svg>
  )
}

function ViewModeIcon({ mode, className }: { mode: LibraryViewMode; className?: string }) {
  if (mode === "list") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 7h12M6 12h12M6 17h12" />
      </svg>
    )
  }

  if (mode === "adaptive") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="6" height="14" rx="1.5" strokeWidth={1.8} />
        <rect x="14" y="5" width="6" height="8" rx="1.5" strokeWidth={1.8} />
        <rect x="14" y="15" width="6" height="4" rx="1.5" strokeWidth={1.8} />
      </svg>
    )
  }

  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="14" y="5" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="4" y="13" width="6" height="6" rx="1.5" strokeWidth={1.8} />
      <rect x="14" y="13" width="6" height="6" rx="1.5" strokeWidth={1.8} />
    </svg>
  )
}

type VideoPlayBadgeProps = {
  compact?: boolean
  className?: string
}

function VideoPlayBadge({ compact = false, className }: VideoPlayBadgeProps) {
  return (
    <div className={cn("pointer-events-none flex items-center justify-center", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full border border-white/70 bg-black/45 text-white shadow-lg backdrop-blur-sm",
          compact ? "h-6 w-6" : "h-12 w-12",
        )}
      >
        <Play className={cn("fill-current", compact ? "h-3 w-3 translate-x-[1px]" : "h-5 w-5 translate-x-[1.5px]")} />
      </div>
    </div>
  )
}

type FilePreviewFallbackProps = {
  ext: string
  compact?: boolean
  className?: string
  iconClassName?: string
  labelClassName?: string
}

function FilePreviewFallback({
  ext,
  compact = false,
  className,
  iconClassName,
  labelClassName,
}: FilePreviewFallbackProps) {
  const upperExt = ext ? ext.toUpperCase() : "FILE"

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 text-gray-500 dark:from-slate-900/70 dark:to-slate-800/90 dark:text-gray-400",
        compact ? "gap-0.5" : "gap-2",
        className,
      )}
    >
      <FileTypeIcon ext={ext} className={cn(compact ? "h-6 w-6" : "h-12 w-12", iconClassName)} />
      <span className={cn("rounded bg-white/80 px-1.5 py-0.5 font-medium text-gray-500 dark:bg-black/20 dark:text-gray-300", compact ? "text-[10px]" : "text-xs", labelClassName)}>
        {upperExt}
      </span>
    </div>
  )
}
