import { type Key, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react"
import { type FileItem } from "@/stores/fileTypes"
import { type LibraryVisibleField, type LibraryViewMode } from "@/stores/settingsStore"
import { AdaptiveFileCard, FileCard, FileRow } from "@/components/file-grid/fileGridCards"
import { ADAPTIVE_VIEWPORT_OVERSCAN_PX, GRID_GAP, type AdaptiveLayoutItem, type SelectionBox } from "@/components/file-grid/fileGridLayout"

type ListVirtualItem = {
  index: number
  key: Key
  size: number
  start: number
}

interface FileGridViewportProps {
  adaptiveLayout: {
    items: AdaptiveLayoutItem[]
    totalHeight: number
    columnWidth: number
    trackWidth: number
  }
  filteredFiles: FileItem[]
  gridColumns: number
  gridItemWidth: number
  gridMetadataHeight: number
  gridRowCount: number
  gridRowHeight: number
  gridRowSpan: number
  gridTrackWidth: number
  gridVirtualRows: number[]
  handleFileClick: (file: FileItem, event: ReactMouseEvent<HTMLDivElement>) => void
  handleFileDoubleClick: (index: number) => void
  handleSelectionStart: (event: ReactMouseEvent<HTMLDivElement>) => void
  handleViewportWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  libraryVisibleFields: LibraryVisibleField[]
  listThumbnailSize: number
  listTotalSize: number
  listVirtualItems: ListVirtualItem[]
  scrollTop: number
  scrollParentRef: RefObject<HTMLDivElement | null>
  selectedFileId: number | null
  selectedFiles: number[]
  selectionBox: SelectionBox | null
  viewportHeight: number
  viewMode: LibraryViewMode
}

export function FileGridViewport({
  adaptiveLayout,
  filteredFiles,
  gridColumns,
  gridItemWidth,
  gridMetadataHeight,
  gridRowCount,
  gridRowHeight,
  gridRowSpan,
  gridTrackWidth,
  gridVirtualRows,
  handleFileClick,
  handleFileDoubleClick,
  handleSelectionStart,
  handleViewportWheel,
  libraryVisibleFields,
  listThumbnailSize,
  listTotalSize,
  listVirtualItems,
  scrollTop,
  scrollParentRef,
  selectedFileId,
  selectedFiles,
  selectionBox,
  viewportHeight,
  viewMode,
}: FileGridViewportProps) {
  const adaptiveVisibleStart = scrollTop - ADAPTIVE_VIEWPORT_OVERSCAN_PX
  const adaptiveVisibleEnd = scrollTop + viewportHeight + ADAPTIVE_VIEWPORT_OVERSCAN_PX
  const adaptiveVisibleItems = adaptiveLayout.items.filter(
    (item) => item.top + item.height >= adaptiveVisibleStart && item.top <= adaptiveVisibleEnd,
  )

  return (
    <div
      ref={scrollParentRef}
      className="relative flex-1 overflow-auto p-3 select-none focus:outline-none"
      tabIndex={0}
      onMouseDown={handleSelectionStart}
      onWheel={handleViewportWheel}
    >
      {viewMode === "adaptive" ? (
        <div
          className="relative"
          style={{
            height: `${adaptiveLayout.totalHeight}px`,
            width: `${adaptiveLayout.trackWidth}px`,
            maxWidth: "100%",
          }}
        >
          {adaptiveVisibleItems.map((item) => (
            <div
              key={`adaptive-${item.index}`}
              className="absolute left-0 top-0"
              style={{
                transform: `translate(${item.left}px, ${item.top}px)`,
                width: `${item.width}px`,
              }}
            >
              <AdaptiveFileCard
                file={item.file}
                previewWidth={item.width}
                visibleFields={libraryVisibleFields}
                isSelected={selectedFileId === item.file.id}
                isMultiSelected={selectedFiles.includes(item.file.id)}
                scrollRootRef={scrollParentRef}
                onClick={(event) => handleFileClick(item.file, event)}
                onDoubleClick={() => handleFileDoubleClick(item.index)}
              />
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
                      previewWidth={gridItemWidth}
                      visibleFields={libraryVisibleFields}
                      isSelected={selectedFileId === file.id}
                      isMultiSelected={selectedFiles.includes(file.id)}
                      scrollRootRef={scrollParentRef}
                      onClick={(event) => handleFileClick(file, event)}
                      onDoubleClick={() => handleFileDoubleClick(startIndex + offset)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="relative" style={{ height: `${listTotalSize}px` }}>
          {listVirtualItems.map((virtualRow) => {
            const file = filteredFiles[virtualRow.index]
            if (!file) {
              return null
            }

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
                  isSelected={selectedFileId === file.id}
                  isMultiSelected={selectedFiles.includes(file.id)}
                  scrollRootRef={scrollParentRef}
                  onClick={(event) => handleFileClick(file, event)}
                  onDoubleClick={() => handleFileDoubleClick(virtualRow.index)}
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
  )
}
