import { type Key, type MouseEvent as ReactMouseEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react"
import { type FileItem } from "@/stores/fileTypes"
import { type LibraryVisibleField, type LibraryViewMode } from "@/stores/settingsStore"
import { AdaptiveFileCard, FileCard, FileRow } from "@/components/file-grid/fileGridCards"
import { GRID_GAP, type SelectionBox } from "@/components/file-grid/fileGridLayout"

type ListVirtualItem = {
  index: number
  key: Key
  size: number
  start: number
}

type AdaptiveColumnItem = {
  file: FileItem
  index: number
  width: number
}

interface FileGridViewportProps {
  adaptiveColumnsData: AdaptiveColumnItem[][]
  adaptiveLayout: {
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
  scrollParentRef: RefObject<HTMLDivElement | null>
  selectedFileId: number | null
  selectedFiles: number[]
  selectionBox: SelectionBox | null
  viewMode: LibraryViewMode
}

export function FileGridViewport({
  adaptiveColumnsData,
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
  scrollParentRef,
  selectedFileId,
  selectedFiles,
  selectionBox,
  viewMode,
}: FileGridViewportProps) {
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
                    isSelected={selectedFileId === file.id}
                    isMultiSelected={selectedFiles.includes(file.id)}
                    scrollRootRef={scrollParentRef}
                    onClick={(event) => handleFileClick(file, event)}
                    onDoubleClick={() => handleFileDoubleClick(index)}
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
