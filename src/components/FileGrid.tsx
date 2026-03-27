import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Play } from "lucide-react"
import { useFileStore, FileItem, getNameWithoutExt } from "@/stores/fileStore"
import { cn } from "@/lib/utils"
import FileTypeIcon from "./FileTypeIcon"
import { canGenerateThumbnail, getImageSrc, getThumbnailImageSrc, getVideoThumbnailSrc, isImageFile, isVideoFile, formatSize } from "@/utils"
import FileContextMenu from "./FileContextMenu"

const GRID_MIN_WIDTH = 180
const GRID_GAP = 16
const LIST_ROW_HEIGHT = 56
const OBSERVER_ROOT_MARGIN = "300px"
const ADAPTIVE_MIN_WIDTH = 220
const ADAPTIVE_CARD_FOOTER_HEIGHT = 48
const ADAPTIVE_CARD_SCALE = 0.96
const VIEWPORT_OVERSCAN_PX = 600
const IMAGE_SRC_CACHE_LIMIT = 300
const INTERNAL_FILE_DRAG_MIME = "application/x-shiguang-file-ids"
const SELECTION_DRAG_THRESHOLD = 10

type SelectionBox = {
  startX: number
  startY: number
  endX: number
  endY: number
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
    setPage,
    setPageSize,
  } = useFileStore()
  const filteredFiles = files
  const [viewMode, setViewMode] = useState<"grid" | "list" | "adaptive">("grid")
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)
  const [draggingFileId, setDraggingFileId] = useState<number | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const scrollParentRef = useRef<HTMLDivElement>(null)

  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const selectionBoxRef = useRef<SelectionBox | null>(null)

  useEffect(() => {
    selectionBoxRef.current = selectionBox
  }, [selectionBox])

  useEffect(() => {
    const element = scrollParentRef.current
    if (!element) return

    const updateWidth = () => {
      setContainerWidth(element.clientWidth)
      setViewportHeight(element.clientHeight)
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

  const contentWidth = Math.max(containerWidth, GRID_MIN_WIDTH)
  const gridColumns = Math.max(1, Math.floor((contentWidth + GRID_GAP) / (GRID_MIN_WIDTH + GRID_GAP)))
  const gridItemWidth = Math.max(0, (contentWidth - GRID_GAP * (gridColumns - 1)) / gridColumns)
  const gridRowHeight = Math.ceil(gridItemWidth + 96)
  const gridRowCount = Math.ceil(filteredFiles.length / gridColumns)
  const gridVisibleStartRow = Math.max(0, Math.floor((scrollTop - VIEWPORT_OVERSCAN_PX) / Math.max(gridRowHeight, 1)))
  const gridVisibleEndRow = Math.min(
    Math.max(0, gridRowCount - 1),
    Math.ceil((scrollTop + viewportHeight + VIEWPORT_OVERSCAN_PX) / Math.max(gridRowHeight, 1)),
  )
  const gridVirtualRows =
    gridRowCount > 0
      ? Array.from(
          { length: Math.max(0, gridVisibleEndRow - gridVisibleStartRow + 1) },
          (_, idx) => gridVisibleStartRow + idx,
        )
      : []
  const adaptiveColumns = Math.max(1, Math.floor((Math.max(containerWidth, ADAPTIVE_MIN_WIDTH) + GRID_GAP) / (ADAPTIVE_MIN_WIDTH + GRID_GAP)))
  const adaptiveColumnWidth = Math.max(0, (Math.max(containerWidth, ADAPTIVE_MIN_WIDTH) - GRID_GAP * (adaptiveColumns - 1)) / adaptiveColumns)
  const adaptiveLayout = buildAdaptiveLayout(filteredFiles, adaptiveColumns, adaptiveColumnWidth)
  const adaptiveVisibleItems = adaptiveLayout.items.filter(
    (item) =>
      item.top + item.height >= scrollTop - VIEWPORT_OVERSCAN_PX &&
      item.top <= scrollTop + viewportHeight + VIEWPORT_OVERSCAN_PX,
  )

  const listRowVirtualizer = useVirtualizer({
    count: filteredFiles.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 8,
  })

  const handleFileClick = (file: FileItem, event: ReactMouseEvent<HTMLDivElement>) => {
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

  const handleBatchDelete = async () => {
    await deleteFiles(selectedFiles)
    setShowBatchDeleteConfirm(false)
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-gray-500 dark:text-gray-400">
        <svg className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-lg font-medium">暂无文件</p>
        <p className="mt-1 text-sm">请在设置中添加索引目录</p>
      </div>
    )
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
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode("adaptive")}
            className={`rounded p-1.5 ${viewMode === "adaptive" ? "bg-gray-200 dark:bg-dark-border" : "hover:bg-gray-100 dark:hover:bg-dark-border"}`}
            title="自适应大小"
          >
            <svg className="h-4 w-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`rounded p-1.5 ${viewMode === "grid" ? "bg-gray-200 dark:bg-dark-border" : "hover:bg-gray-100 dark:hover:bg-dark-border"}`}
            title="网格视图"
          >
            <svg className="h-4 w-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`rounded p-1.5 ${viewMode === "list" ? "bg-gray-200 dark:bg-dark-border" : "hover:bg-gray-100 dark:hover:bg-dark-border"}`}
            title="列表视图"
          >
            <svg className="h-4 w-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={scrollParentRef}
        className="relative flex-1 overflow-auto p-4 select-none"
        onMouseDown={handleSelectionStart}
      >
        {viewMode === "adaptive" ? (
          <div className="relative" style={{ height: `${adaptiveLayout.totalHeight}px` }}>
            {adaptiveVisibleItems.map(({ file, index, left, top, width }) => (
              <div
                key={`adaptive-${index}`}
                className="absolute"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${width}px`,
                }}
              >
                <AdaptiveFileCard
                  file={file}
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
        ) : viewMode === "grid" ? (
          <div className="relative" style={{ height: `${gridRowCount * gridRowHeight}px` }}>
            {gridVirtualRows.map((rowIndex) => {
              const startIndex = rowIndex * gridColumns
              const rowFiles = filteredFiles.slice(startIndex, startIndex + gridColumns)

              return (
                <div
                  key={rowIndex}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${gridRowHeight}px`,
                    transform: `translateY(${rowIndex * gridRowHeight}px)`,
                  }}
                >
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
                  >
                    {rowFiles.map((file, offset) => (
                      <FileCard
                        key={`grid-${rowIndex}-${offset}`}
                        file={file}
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
  left: number
  top: number
  width: number
  height: number
}

function buildAdaptiveLayout(files: FileItem[], columns: number, columnWidth: number) {
  if (files.length === 0 || columnWidth <= 0) {
    return { items: [] as AdaptiveLayoutItem[], totalHeight: 0 }
  }

  const visualWidth = Math.max(120, Math.round(columnWidth * ADAPTIVE_CARD_SCALE))
  const horizontalInset = (columnWidth - visualWidth) / 2
  const heights = Array.from({ length: columns }, () => 0)
  const items: AdaptiveLayoutItem[] = files.map((file, index) => {
    const imageHeight = getAdaptiveImageHeight(file, visualWidth)
    const totalHeight = imageHeight + ADAPTIVE_CARD_FOOTER_HEIGHT
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
      left,
      top,
      width: visualWidth,
      height: totalHeight,
    }
  })

  return {
    items,
    totalHeight: Math.max(0, ...heights) - GRID_GAP,
  }
}

function getAdaptiveImageHeight(file: FileItem, width: number) {
  if (!file.width || !file.height || file.width <= 0 || file.height <= 0) {
    return width
  }

  return Math.max(80, Math.round((file.height / file.width) * width))
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
  isMultiSelected: boolean
  isDragging: boolean
  scrollRootRef: RefObject<HTMLDivElement | null>
  onClick: (e: ReactMouseEvent<HTMLDivElement>) => void
  onDoubleClick?: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

function FileCard({ file, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    event.dataTransfer.setData("text/plain", draggedFileIds.join(","))
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
              : "hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"
          }`}
        >
          <div className="relative bg-gray-100 pb-[100%] dark:bg-dark-bg">
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
          <div className="bg-white p-2 dark:bg-dark-surface">
            <p className="truncate text-xs text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {file.ext.toUpperCase()} · {formatSize(file.size)}
            </p>
            {file.tags.length > 0 && (
              <div className="mt-1.5 flex max-h-10 flex-wrap gap-1 overflow-hidden">
                {file.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-1.5 py-0.5 text-[10px] text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {file.tags.length > 3 && <span className="text-[10px] text-gray-400">+{file.tags.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function AdaptiveFileCard({ file, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    event.dataTransfer.setData("text/plain", draggedFileIds.join(","))
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
          className={`file-card group relative overflow-hidden rounded-lg transition-all ${isDragging ? "opacity-50" : "cursor-pointer"} ${
            isMultiSelected
              ? "ring-2 ring-primary-500 shadow-lg"
              : "hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"
          }`}
        >
          <div className="relative bg-gray-100 dark:bg-dark-bg" style={{ paddingBottom: getAspectRatio() }}>
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
          <div className="bg-white p-2 dark:bg-dark-surface">
            <p className="truncate text-xs text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            <p className="text-[10px] text-gray-400">
              {file.ext.toUpperCase()} · {formatSize(file.size)}
            </p>
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function FileRow({ file, isMultiSelected, isDragging, scrollRootRef, onClick, onDoubleClick, onDragStart, onDragEnd }: FileCardBaseProps) {
  const { ref: visibilityRef, isVisible } = useVisibility(scrollRootRef)
  const cacheKey = `${file.path}:${file.modifiedAt}:${file.size}`
  const { imageSrc, imageError, setImageError } = useLazyImageSrc(file.path, file.ext, cacheKey, isVisible)
  const isVideo = isVideoFile(file.ext)
  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    const draggedFileIds = useFileStore.getState().beginInternalFileDrag(file.id)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_MIME, JSON.stringify(draggedFileIds))
    event.dataTransfer.setData("text/plain", draggedFileIds.join(","))
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
              : "hover:bg-gray-100 dark:hover:bg-dark-border"
          }`}
        >
          <div
            className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100 dark:bg-dark-bg"
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
            <p className="truncate text-sm text-gray-700 dark:text-gray-200">{getNameWithoutExt(file.name)}</p>
            <p className="text-xs text-gray-400">
              {getFileMetaText(file)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
            <span className="text-xs text-gray-400">{file.ext.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </FileContextMenu>
  )
}

function getFileMetaText(file: FileItem) {
  if (file.width > 0 && file.height > 0) {
    return `${file.width} x ${file.height}`
  }

  return "无预览尺寸"
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
