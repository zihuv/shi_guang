import { useEffect, useState, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useFileStore, FileItem, getNameWithoutExt } from '@/stores/fileStore'
import { useTagStore } from '@/stores/tagStore'
import { readFile, exists } from '@tauri-apps/plugin-fs'
import FileContextMenu from './FileContextMenu'

// Helper to get image URL from file path using fs plugin
async function getImageSrc(path: string): Promise<string> {
  try {
    // First check if file exists to avoid unnecessary read errors
    const fileExists = await exists(path)
    if (!fileExists) {
      return ''
    }
    const contents = await readFile(path)
    const blob = new Blob([contents])
    return URL.createObjectURL(blob)
  } catch (e: any) {
    // 文件不存在或已删除，静默处理，不显示错误
    if (e?.message?.includes('No such file or directory')) {
      return ''
    }
    console.error('Failed to read file:', e)
    return ''
  }
}

export default function FileGrid() {
  const { files, selectedFile, setSelectedFile, isLoading, selectedFiles, toggleFileSelection, clearSelection, deleteFiles, openPreview } = useFileStore()
  const { selectedTagId } = useTagStore()
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'adaptive'>('grid')
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false)

  // Box selection state
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const selectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedTagId) {
      setFilteredFiles(files.filter(f => f.tags.some(t => t.id === selectedTagId)))
    } else {
      setFilteredFiles(files)
    }
  }, [files, selectedTagId])

  // Handle Ctrl+click for multi-selection
  const handleFileClick = (file: FileItem, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click toggles selection
      toggleFileSelection(file.id)
    } else {
      // Normal click selects single file
      setSelectedFile(file)
    }
  }

  // Handle double-click to open preview
  const handleFileDoubleClick = (index: number) => {
    openPreview(index, filteredFiles)
  }

  // Handle box selection start
  const handleSelectionStart = (event: React.MouseEvent) => {
    // Only start box selection when clicking on the background, not on files
    const target = event.target as HTMLElement
    if (target.closest('.file-card')) {
      // Clicking on a file card - don't clear selection
      return
    }

    // Click on empty space - clear selection first, then start selection
    if (selectedFiles.length > 0) {
      clearSelection()
    }
    // Also clear the selected file
    if (selectedFile) {
      setSelectedFile(null)
    }

    setIsSelecting(true)
    const rect = selectionRef.current?.getBoundingClientRect()
    if (rect) {
      setSelectionBox({
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        endX: event.clientX - rect.left,
        endY: event.clientY - rect.top,
      })
    }
  }

  // Handle box selection move
  const handleSelectionMove = (event: React.MouseEvent) => {
    if (!isSelecting || !selectionBox || !selectionRef.current) return

    const rect = selectionRef.current.getBoundingClientRect()
    setSelectionBox({
      ...selectionBox,
      endX: event.clientX - rect.left,
      endY: event.clientY - rect.top,
    })
  }

  // Handle box selection end
  const handleSelectionEnd = () => {
    if (!isSelecting || !selectionBox || !selectionRef.current) {
      setIsSelecting(false)
      return
    }

    // Calculate the selection rectangle
    const minX = Math.min(selectionBox.startX, selectionBox.endX)
    const maxX = Math.max(selectionBox.startX, selectionBox.endX)
    const minY = Math.min(selectionBox.startY, selectionBox.endY)
    const maxY = Math.max(selectionBox.startY, selectionBox.endY)

    // Only select if the box is large enough (at least 10px)
    if (maxX - minX > 10 && maxY - minY > 10) {
      // Get all file card elements and check which ones intersect with the selection box
      const cards = selectionRef.current.querySelectorAll('.file-card')
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect()
        const containerRect = selectionRef.current!.getBoundingClientRect()

        // Calculate card position relative to container
        const cardX = rect.left - containerRect.left + rect.width / 2
        const cardY = rect.top - containerRect.top + rect.height / 2

        // Check if card center is within selection box
        if (cardX >= minX && cardX <= maxX && cardY >= minY && cardY <= maxY) {
          const fileId = parseInt(card.getAttribute('data-file-id') || '0')
          if (fileId && !selectedFiles.includes(fileId)) {
            toggleFileSelection(fileId)
          }
        }
      })
    }

    setIsSelecting(false)
    setSelectionBox(null)
  }

  // Handle batch delete
  const handleBatchDelete = async () => {
    await deleteFiles(selectedFiles)
    setShowBatchDeleteConfirm(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">加载中...</div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <svg className="w-16 h-16 mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-lg font-medium">暂无文件</p>
        <p className="text-sm mt-1">请在设置中添加索引目录</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {selectedFiles.length > 0 ? `已选择 ${selectedFiles.length} / ` : ''}{filteredFiles.length} 个文件
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('adaptive')}
            className={`p-1.5 rounded ${viewMode === 'adaptive' ? 'bg-gray-200 dark:bg-dark-border' : 'hover:bg-gray-100 dark:hover:bg-dark-border'}`}
            title="自适应大小"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-gray-200 dark:bg-dark-border' : 'hover:bg-gray-100 dark:hover:bg-dark-border'}`}
            title="网格视图"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-200 dark:bg-dark-border' : 'hover:bg-gray-100 dark:hover:bg-dark-border'}`}
            title="列表视图"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={selectionRef}
        className="flex-1 overflow-auto p-4 relative select-none"
        onMouseDown={handleSelectionStart}
        onMouseMove={handleSelectionMove}
        onMouseUp={handleSelectionEnd}
        onMouseLeave={handleSelectionEnd}
      >
        {viewMode === 'adaptive' ? (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
            {filteredFiles.map((file, index) => (
              <div key={file.id} className="break-inside-avoid">
                <AdaptiveFileCard
                  file={file}
                  isSelected={selectedFile?.id === file.id}
                  isMultiSelected={selectedFiles.includes(file.id)}
                  onClick={(e: React.MouseEvent) => handleFileClick(file, e)}
                  onDoubleClick={() => handleFileDoubleClick(index)}
                />
              </div>
            ))}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {filteredFiles.map((file, index) => (
              <FileCard
                key={file.id}
                file={file}
                isSelected={selectedFile?.id === file.id}
                isMultiSelected={selectedFiles.includes(file.id)}
                onClick={(e: React.MouseEvent) => handleFileClick(file, e)}
                onDoubleClick={() => handleFileDoubleClick(index)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredFiles.map((file, index) => (
              <FileRow
                key={file.id}
                file={file}
                isSelected={selectedFile?.id === file.id}
                isMultiSelected={selectedFiles.includes(file.id)}
                onClick={(e: React.MouseEvent) => handleFileClick(file, e)}
                onDoubleClick={() => handleFileDoubleClick(index)}
              />
            ))}
          </div>
        )}

        {/* Selection box overlay */}
        {selectionBox && (
          <div
            className="absolute border-2 border-primary-500 bg-primary-500/10 pointer-events-none"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.endX),
              top: Math.min(selectionBox.startY, selectionBox.endY),
              width: Math.abs(selectionBox.endX - selectionBox.startX),
              height: Math.abs(selectionBox.endY - selectionBox.startY),
            }}
          />
        )}
      </div>

      {/* Batch action bar */}
      {selectedFiles.length > 0 && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white dark:bg-dark-surface border border-gray-200 dark:border-dark-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-4 z-50">
          <span className="text-sm text-gray-700 dark:text-gray-200">
            已选择 {selectedFiles.length} 个文件
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => clearSelection()}
              className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
            >
              取消选择
            </button>
            {showBatchDeleteConfirm ? (
              <>
                <button
                  onClick={handleBatchDelete}
                  className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded"
                >
                  确认删除
                </button>
                <button
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded"
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

function FileCard({ file, isSelected: _isSelected, isMultiSelected, onClick, onDoubleClick }: {
  file: FileItem
  isSelected: boolean
  isMultiSelected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
}) {
  const { files } = useFileStore()
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  // dnd-kit useDraggable
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file-${file.id}`,
    data: { type: 'app-file', fileId: file.id, fileName: file.name }
  })

  // 检查文件是否还存在
  const fileExists = files.some(f => f.id === file.id)

  useEffect(() => {
    if (!fileExists) return
    let mounted = true
    setImageSrc(null)
    getImageSrc(file.path).then(src => {
      if (mounted) setImageSrc(src)
    })
    return () => { mounted = false }
  }, [file.path, fileExists])

  // 强制正方形格子
  const getContainerStyle = () => {
    return { paddingBottom: '100%' }
  }

  return (
    <FileContextMenu file={file}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-file-id={file.id}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`group relative rounded-lg overflow-hidden transition-all file-card ${isDragging ? 'opacity-50' : 'cursor-pointer'} ${
          isMultiSelected
            ? 'ring-2 ring-primary-500 shadow-lg'
            : 'hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
        }`}
      >
        <div className="relative bg-gray-100 dark:bg-dark-bg" style={getContainerStyle()}>
          {imageSrc === null ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          ) : imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="absolute inset-0 w-full h-full object-contain"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        <div className="p-2 bg-white dark:bg-dark-surface">
          <p className="text-xs text-gray-700 dark:text-gray-200 truncate">{getNameWithoutExt(file.name)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{file.ext.toUpperCase()} · {formatSize(file.size)}</p>
          {file.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {file.tags.slice(0, 3).map(tag => (
                <span
                  key={tag.id}
                  className="px-1.5 py-0.5 text-[10px] rounded-full text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {file.tags.length > 3 && (
                <span className="text-[10px] text-gray-400">+{file.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </FileContextMenu>
  )
}

function AdaptiveFileCard({ file, isSelected: _isSelected, isMultiSelected, onClick, onDoubleClick }: {
  file: FileItem
  isSelected: boolean
  isMultiSelected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
}) {
  const { files } = useFileStore()
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  // dnd-kit useDraggable
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file-${file.id}`,
    data: { type: 'app-file', fileId: file.id, fileName: file.name }
  })

  const fileExists = files.some(f => f.id === file.id)

  useEffect(() => {
    if (!fileExists) return
    let mounted = true
    setImageSrc(null)
    getImageSrc(file.path).then(src => {
      if (mounted) setImageSrc(src)
    })
    return () => { mounted = false }
  }, [file.path, fileExists])

  // 瀑布流布局：使用 aspect-ratio 让高度按原始比例自动计算
  // 宽度由 CSS columns 控制（100% 适应列宽）
  const getAspectRatio = () => {
    if (!file.width || !file.height || file.width === 0) {
      return '100%'
    }
    return `${(file.height / file.width) * 100}%`
  }

  return (
    <FileContextMenu file={file}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-file-id={file.id}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`group relative rounded-lg overflow-hidden transition-all file-card ${isDragging ? 'opacity-50' : 'cursor-pointer'} ${
          isMultiSelected
            ? 'ring-2 ring-primary-500 shadow-lg'
            : 'hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
        }`}
      >
        <div
          className="relative bg-gray-100 dark:bg-dark-bg"
          style={{ paddingBottom: getAspectRatio() }}
        >
          {imageSrc === null ? (
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ) : imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="absolute inset-0 w-full h-full object-contain"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>
        {/* 始终显示文件名 */}
        <div className="p-2 bg-white dark:bg-dark-surface">
          <p className="text-xs text-gray-700 dark:text-gray-200 truncate">{getNameWithoutExt(file.name)}</p>
          <p className="text-[10px] text-gray-400">{file.ext.toUpperCase()} · {formatSize(file.size)}</p>
        </div>
      </div>
    </FileContextMenu>
  )
}

function FileRow({ file, isSelected: _isSelected, isMultiSelected, onClick, onDoubleClick }: {
  file: FileItem
  isSelected: boolean
  isMultiSelected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
}) {
  const { files } = useFileStore()
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

  // dnd-kit useDraggable
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `file-${file.id}`,
    data: { type: 'app-file', fileId: file.id, fileName: file.name }
  })

  // 检查文件是否还存在
  const fileExists = files.some(f => f.id === file.id)

  useEffect(() => {
    if (!fileExists) return
    let mounted = true
    setImageSrc(null)
    getImageSrc(file.path).then(src => {
      if (mounted) setImageSrc(src)
    })
    return () => { mounted = false }
  }, [file.path, fileExists])

  return (
    <FileContextMenu file={file}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-file-id={file.id}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={`flex items-center gap-3 p-2 rounded-lg transition-colors file-card ${isDragging ? 'opacity-50' : 'cursor-pointer'} ${
          isMultiSelected
            ? 'bg-primary-50 dark:bg-primary-900/20'
            : 'hover:bg-gray-100 dark:hover:bg-dark-border'
        }`}
      >
        <div
          className="rounded bg-gray-100 dark:bg-dark-bg flex-shrink-0 overflow-hidden flex items-center justify-center"
          style={{ width: 40, height: 40 }}
        >
          {imageSrc === null ? (
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ) : imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="max-w-full max-h-full object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{getNameWithoutExt(file.name)}</p>
          <p className="text-xs text-gray-400">{file.width} x {file.height}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
          <span className="text-xs text-gray-400">{file.ext.toUpperCase()}</span>
        </div>
      </div>
    </FileContextMenu>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
