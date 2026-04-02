import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useFileStore, FileItem } from '@/stores/fileStore'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { copyFilesToClipboard } from '@/lib/clipboard'
import { startExternalFileDrag } from '@/lib/externalDrag'
import FileTypeIcon from '@/components/FileTypeIcon'
import { formatSize, getFilePreviewMode, getFileSrc, getTextPreviewContent, getVideoThumbnailSrc, isPdfFile, isVideoFile } from '@/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/ContextMenu'
import { ExternalLink, FolderOpen, Copy, Move, Trash2 } from 'lucide-react'

const MIN_ZOOM = 1
const MAX_ZOOM = 10000
const BASE_WHEEL_ZOOM_SENSITIVITY = 0.002

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function ImagePreview() {
  const {
    previewMode,
    previewIndex,
    previewFiles,
    setPreviewIndex,
    closePreview,
    setSelectedFile,
    moveFiles,
    copyFiles,
  } = useFileStore()

  const { folders, selectedFolderId } = useFolderStore()
  const previewTrackpadZoomSpeed = useSettingsStore((state) => state.previewTrackpadZoomSpeed)

  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string>("")
  const [imageError, setImageError] = useState(false)
  const [zoom, setZoom] = useState<number | 'auto'>('auto')  // 'auto' = 适应窗口, 100 = 原始尺寸, 其他数字 = 缩放比例
  const [isLoading, setIsLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [isPanning, setIsPanning] = useState(false)

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const previousZoomRef = useRef<number | 'auto'>('auto')
  const shouldCenterImageRef = useRef(false)
  const lastPreviewFileIdRef = useRef<number | null>(null)
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null)

  // 获取当前文件夹名称
  const currentFolderName = selectedFolderId
    ? folders.find(f => f.id === selectedFolderId)?.name || '未知文件夹'
    : '全部文件'

  // 当前文件
  const currentFile = previewFiles[previewIndex]
  const previewType = currentFile ? getFilePreviewMode(currentFile.ext) : 'none'
  const isVideo = currentFile ? isVideoFile(currentFile.ext) : false
  const isPdf = currentFile ? isPdfFile(currentFile.ext) : false
  const isImageLike = previewType === 'image'
  const supportsZoom = previewType === 'image'
  const wheelZoomSensitivity = BASE_WHEEL_ZOOM_SENSITIVITY * previewTrackpadZoomSpeed

  // 切换预览时同步更新选中文件
  useEffect(() => {
    if (currentFile) {
      setSelectedFile(currentFile)
    }
  }, [previewIndex, currentFile, setSelectedFile])

  useEffect(() => {
    if (!currentFile) {
      lastPreviewFileIdRef.current = null
      return
    }

    const previousFileId = lastPreviewFileIdRef.current
    if (previousFileId !== null && previousFileId !== currentFile.id) {
      const nextPreviewType = getFilePreviewMode(currentFile.ext)
      if (nextPreviewType === 'image') {
        shouldCenterImageRef.current = true
        setZoom(100)
      } else {
        setZoom('auto')
      }
      panStateRef.current = null
      setIsPanning(false)
    }

    lastPreviewFileIdRef.current = currentFile.id
  }, [currentFile])

  // 加载图片
  useEffect(() => {
    if (!currentFile) return

    let mounted = true
    setIsLoading(true)
    setImageError(false)
    setImageSrc(null)
    setTextContent("")

    if (previewType === 'none') {
      setIsLoading(false)
      return () => {
        mounted = false
      }
    }

    if (previewType === 'text') {
      getTextPreviewContent(currentFile.path, currentFile.size).then((content) => {
        if (mounted) {
          setTextContent(content)
          setIsLoading(false)
        }
      })

      return () => {
        mounted = false
      }
    }

    getFileSrc(currentFile.path).then(src => {
      if (mounted) {
        if (src) {
          setImageSrc(src)
        } else {
          setImageError(true)
        }
        setIsLoading(false)
      }
    })

    return () => {
      mounted = false
    }
  }, [currentFile?.path, currentFile?.size, previewType])

  // 清理 URL 对象
  useEffect(() => {
    return () => {
      if (imageSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc)
      }
    }
  }, [imageSrc])

  // 键盘导航
  useEffect(() => {
    if (!previewMode) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          if (isFullscreen) {
            setIsFullscreen(false)
          } else {
            closePreview()
          }
          break
        case 'ArrowLeft':
          goToPrev()
          break
        case 'ArrowRight':
          goToNext()
          break
        case 'f':
        case 'F':
          if (previewType !== 'none') {
            setIsFullscreen(prev => !prev)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewMode, previewIndex, previewFiles.length, isFullscreen, previewType])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return

    const updateViewportSize = () => {
      setViewportSize({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    updateViewportSize()

    const observer = new ResizeObserver(() => {
      updateViewportSize()
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [isFullscreen, previewIndex, previewMode])

  useEffect(() => {
    const container = viewportRef.current
    if (!container || zoom === 'auto') {
      previousZoomRef.current = zoom
      return
    }

    if (!pendingScrollRef.current && (previousZoomRef.current === 'auto' || shouldCenterImageRef.current)) {
      requestAnimationFrame(() => {
        const nextContainer = viewportRef.current
        if (!nextContainer) return
        nextContainer.scrollLeft = Math.max(0, (nextContainer.scrollWidth - nextContainer.clientWidth) / 2)
        nextContainer.scrollTop = Math.max(0, (nextContainer.scrollHeight - nextContainer.clientHeight) / 2)
      })
      shouldCenterImageRef.current = false
    }

    previousZoomRef.current = zoom
  }, [zoom, previewIndex, isFullscreen])

  useEffect(() => {
    if (zoom === 'auto') {
      pendingScrollRef.current = null
      return
    }

    const container = viewportRef.current
    const pendingScroll = pendingScrollRef.current
    if (!container || !pendingScroll) {
      return
    }

    requestAnimationFrame(() => {
      const nextContainer = viewportRef.current
      const nextPendingScroll = pendingScrollRef.current
      if (!nextContainer || !nextPendingScroll) return

      const maxScrollLeft = Math.max(0, nextContainer.scrollWidth - nextContainer.clientWidth)
      const maxScrollTop = Math.max(0, nextContainer.scrollHeight - nextContainer.clientHeight)

      nextContainer.scrollLeft = clampValue(nextPendingScroll.left, 0, maxScrollLeft)
      nextContainer.scrollTop = clampValue(nextPendingScroll.top, 0, maxScrollTop)
      pendingScrollRef.current = null
    })
  }, [zoom, previewIndex, isFullscreen, viewportSize.width, viewportSize.height])

  useEffect(() => {
    if (zoom === 'auto') {
      viewportRef.current?.scrollTo({ left: 0, top: 0 })
    }
  }, [zoom, previewIndex])

  // 扁平化文件夹树
  const flattenFolders = (nodes: FolderNode[], depth = 0): FolderNode[] => {
    let result: FolderNode[] = []
    for (const node of nodes) {
      result.push({ ...node, sortOrder: depth } as FolderNode)
      if (node.children && node.children.length > 0) {
        result = result.concat(flattenFolders(node.children, depth + 1))
      }
    }
    return result
  }

  const flatFolders = flattenFolders(folders)
  const menuItems = [
    { id: null, name: '根目录', sortOrder: -1 as const },
    ...flatFolders
  ]

  // 打开文件
  const handleOpenFile = async () => {
    try {
      await invoke('open_file', { fileId: currentFile.id })
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  // 在资源管理器中显示
  const handleShowInExplorer = async () => {
    try {
      await invoke('show_in_explorer', { fileId: currentFile.id })
    } catch (e) {
      console.error('Failed to open directory:', e)
    }
  }

  const handleCopyFileToClipboard = async () => {
    try {
      await copyFilesToClipboard([currentFile.id])
    } catch (e) {
      console.error('Failed to copy file to clipboard:', e)
    }
  }

  const handleExternalDragStart = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()

    void startExternalFileDrag([currentFile.id]).catch((error) => {
      console.error('Failed to start external drag:', error)
      toast.error('拖拽到外部应用失败')
    })
  }

  // 复制到
  const handleCopyFile = async (targetFolderId: number | null) => {
    try {
      await copyFiles([currentFile.id], targetFolderId)
    } catch (e) {
      console.error('Failed to copy file:', e)
    }
  }

  // 移动到
  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await moveFiles([currentFile.id], targetFolderId)
    } catch (e) {
      console.error('Failed to move file:', e)
    }
  }

  // 删除文件
  const handleDeleteFile = async () => {
    try {
      await invoke('delete_file', { fileId: currentFile.id })
      closePreview()
    } catch (e) {
      console.error('Failed to delete file:', e)
    }
  }

  // 切换上一张
  const goToPrev = useCallback(() => {
    if (previewIndex > 0) {
      setPreviewIndex(previewIndex - 1)
    }
  }, [previewIndex, setPreviewIndex])

  // 切换下一张
  const goToNext = useCallback(() => {
    if (previewIndex < previewFiles.length - 1) {
      setPreviewIndex(previewIndex + 1)
    }
  }, [previewIndex, previewFiles.length, setPreviewIndex])

  // 判断是否为适应窗口模式（'auto' 表示适应窗口）
  const isFitMode = zoom === 'auto'
  const canPanImage = isImageLike && !isFitMode
  const manualZoomScale = typeof zoom === 'number' ? zoom / 100 : 1
  const imageWidth = currentFile.width > 0 ? currentFile.width : null
  const imageHeight = currentFile.height > 0 ? currentFile.height : null
  const fitZoomPercent =
    imageWidth && imageHeight && viewportSize.width > 0 && viewportSize.height > 0
      ? clampZoom(
          Math.min(
            100,
            Math.floor(
              Math.min(
                Math.max(1, viewportSize.width - 32) / imageWidth,
                Math.max(1, viewportSize.height - 32) / imageHeight,
              ) * 100,
            ),
          ),
        )
      : 100
  const scaledImageWidth =
    !isFitMode && imageWidth
      ? Math.max(1, Math.round(imageWidth * manualZoomScale))
      : null
  const scaledImageHeight =
    !isFitMode && imageHeight
      ? Math.max(1, Math.round(imageHeight * manualZoomScale))
      : null
  const manualCanvasWidth =
    scaledImageWidth !== null
      ? Math.max(scaledImageWidth, viewportSize.width)
      : null
  const manualCanvasHeight =
    scaledImageHeight !== null
      ? Math.max(scaledImageHeight, viewportSize.height)
      : null
  const manualImageOffsetLeft =
    scaledImageWidth !== null && manualCanvasWidth !== null
      ? Math.max(0, Math.round((manualCanvasWidth - scaledImageWidth) / 2))
      : 0
  const manualImageOffsetTop =
    scaledImageHeight !== null && manualCanvasHeight !== null
      ? Math.max(0, Math.round((manualCanvasHeight - scaledImageHeight) / 2))
      : 0

  // 处理缩放滑块
  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value)
    setZoom(clampZoom(value))
  }

  // 适应窗口
  const handleZoomFit = () => {
    setZoom('auto')
  }

  // 1:1 缩放
  const handleZoom100 = () => {
    shouldCenterImageRef.current = true
    setZoom(100)
  }

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!supportsZoom) return
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()
    const container = viewportRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pointerX = e.clientX - rect.left
    const pointerY = e.clientY - rect.top
    const currentScrollLeft = container.scrollLeft
    const currentScrollTop = container.scrollTop

    const deltaY = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY

    setZoom(prevZoom => {
      const baseZoom = prevZoom === 'auto' ? fitZoomPercent : prevZoom
      const nextZoom = clampZoom(baseZoom * Math.exp(-deltaY * wheelZoomSensitivity))
      const currentScale = baseZoom / 100
      const nextScale = nextZoom / 100

      if (imageWidth && imageHeight) {
        const currentCanvasWidth = Math.max(imageWidth * currentScale, viewportSize.width)
        const currentCanvasHeight = Math.max(imageHeight * currentScale, viewportSize.height)
        const currentImageOffsetLeft = Math.max(0, (currentCanvasWidth - imageWidth * currentScale) / 2)
        const currentImageOffsetTop = Math.max(0, (currentCanvasHeight - imageHeight * currentScale) / 2)
        const nextCanvasWidth = Math.max(imageWidth * nextScale, viewportSize.width)
        const nextCanvasHeight = Math.max(imageHeight * nextScale, viewportSize.height)
        const nextImageOffsetLeft = Math.max(0, (nextCanvasWidth - imageWidth * nextScale) / 2)
        const nextImageOffsetTop = Math.max(0, (nextCanvasHeight - imageHeight * nextScale) / 2)

        const imageCoordinateX = clampValue(
          (currentScrollLeft + pointerX - currentImageOffsetLeft) / currentScale,
          0,
          imageWidth,
        )
        const imageCoordinateY = clampValue(
          (currentScrollTop + pointerY - currentImageOffsetTop) / currentScale,
          0,
          imageHeight,
        )

        pendingScrollRef.current = {
          left: nextImageOffsetLeft + imageCoordinateX * nextScale - pointerX,
          top: nextImageOffsetTop + imageCoordinateY * nextScale - pointerY,
        }
      }

      return Math.round(nextZoom * 100) / 100
    })
  }

  const finishPan = (pointerId: number) => {
    const container = viewportRef.current
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId)
    }
    panStateRef.current = null
    setIsPanning(false)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPanImage || e.button !== 0) return

    const container = viewportRef.current
    if (!container) return

    panStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    }
    container.setPointerCapture(e.pointerId)
    setIsPanning(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    const container = viewportRef.current
    if (!panState || !container || panState.pointerId !== e.pointerId) return

    const deltaX = e.clientX - panState.startX
    const deltaY = e.clientY - panState.startY
    container.scrollLeft = panState.scrollLeft - deltaX
    container.scrollTop = panState.scrollTop - deltaY
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || panState.pointerId !== e.pointerId) return
    finishPan(e.pointerId)
  }

  if (!previewMode || !currentFile) return null

  const totalFiles = previewFiles.length
  const currentNum = previewIndex + 1
  const canGoPrev = previewIndex > 0
  const canGoNext = previewIndex < totalFiles - 1
  const previewMeta = getPreviewMetaText(currentFile)
  const previewShell = (
    <div className={isFullscreen ? "fixed inset-0 z-[80] flex flex-col bg-gray-100 dark:bg-dark-bg" : "h-full flex flex-col bg-gray-100 dark:bg-dark-bg"}>
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center gap-4">
          <span className="text-sm">{currentFolderName}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 左右导航 */}
          <button
            onClick={goToPrev}
            disabled={!canGoPrev}
            className={`p-1.5 rounded ${canGoPrev ? 'hover:bg-gray-200 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'}`}
            title="上一张"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm min-w-[60px] text-center">
            {currentNum} / {totalFiles}
          </span>
          <button
            onClick={goToNext}
            disabled={!canGoNext}
            className={`p-1.5 rounded ${canGoNext ? 'hover:bg-gray-200 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'}`}
            title="下一张"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {supportsZoom ? (
            <>
              {/* 缩放滑块 */}
              <div className="flex items-center">
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  value={zoom === 'auto' ? fitZoomPercent : zoom}
                  onChange={handleZoomChange}
                  className="w-28"
                />
              </div>

              {/* 适应窗口按钮 */}
              <button
                onClick={handleZoomFit}
                className={`px-2 py-1 text-sm rounded ${zoom === 'auto' ? 'bg-gray-300 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                title="适应窗口"
              >
                适应
              </button>

              {/* 1:1 按钮 */}
              <button
                onClick={handleZoom100}
                className={`px-2 py-1 text-sm rounded ${zoom === 100 ? 'bg-gray-300 dark:bg-gray-600' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                title="原始尺寸"
              >
                1:1
              </button>
            </>
          ) : (
            <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 dark:bg-dark-border dark:text-gray-300">
              {previewType === 'video' ? '视频播放' : previewType === 'pdf' ? 'PDF 预览' : '文件预览'}
            </span>
          )}

          {previewType !== 'none' && (
            <button
              onClick={toggleFullscreen}
              className="px-2 py-1 text-sm rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              title={isFullscreen ? '退出全屏 (F)' : '全屏预览 (F)'}
            >
              {isFullscreen ? '退出全屏' : '全屏'}
            </button>
          )}

          {/* 关闭按钮 */}
          <button
            onClick={closePreview}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            title="关闭 (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 中间大图预览 */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={viewportRef}
            className={`preview-wheel-container flex-1 overflow-auto ${canPanImage ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {isLoading ? (
              <div className="flex h-full min-h-full items-center justify-center p-4">
                <svg className="w-10 h-10 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            ) : imageError ? (
              <div className="flex h-full min-h-full flex-col items-center justify-center p-4 text-gray-400">
                <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p>无法加载预览</p>
              </div>
            ) : previewType === 'none' ? (
              <div className="flex h-full min-h-full items-center justify-center p-4">
                <UnsupportedPreviewState file={currentFile} onOpenFile={handleOpenFile} />
              </div>
            ) : previewType === 'text' ? (
              <TextPreviewPane content={textContent} />
            ) : imageSrc ? (
              isVideo ? (
                <div className="flex h-full min-h-full items-center justify-center p-4">
                  <video
                    src={imageSrc}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-full w-full max-w-5xl rounded-lg bg-black shadow-lg"
                  />
                </div>
              ) : isPdf ? (
                <div className="h-full min-h-full p-4">
                  <object
                    data={imageSrc}
                    type="application/pdf"
                    className="h-full w-full rounded-lg bg-white"
                  >
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
                      <p>当前环境不支持 PDF 内嵌预览</p>
                      <p className="text-xs">可以使用右键菜单用默认应用打开</p>
                    </div>
                  </object>
                </div>
              ) : isImageLike ? (
                isFitMode || manualCanvasWidth === null || manualCanvasHeight === null || scaledImageWidth === null || scaledImageHeight === null ? (
                  <div className="flex h-full min-h-full items-center justify-center p-4">
                    <img
                      src={imageSrc}
                      alt={currentFile.name}
                      draggable
                      onDragStart={handleExternalDragStart}
                      className="max-w-full max-h-full object-contain select-none"
                    />
                  </div>
                ) : (
                  <div
                    className="relative"
                    style={{
                      width: `${manualCanvasWidth}px`,
                      height: `${manualCanvasHeight}px`,
                    }}
                  >
                    <img
                      src={imageSrc}
                      alt={currentFile.name}
                      draggable={false}
                      className="absolute block select-none"
                      style={{
                        width: `${scaledImageWidth}px`,
                        height: `${scaledImageHeight}px`,
                        left: `${manualImageOffsetLeft}px`,
                        top: `${manualImageOffsetTop}px`,
                      }}
                    />
                  </div>
                )
              ) : null
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleOpenFile}>
            <ExternalLink className="w-4 h-4 mr-2" />
            默认应用打开
          </ContextMenuItem>
        <ContextMenuItem onClick={handleShowInExplorer}>
          <FolderOpen className="w-4 h-4 mr-2" />
          在资源管理器中显示
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyFileToClipboard}>
          <Copy className="w-4 h-4 mr-2" />
          复制到剪贴板
        </ContextMenuItem>
        <ContextMenuSeparator />

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Copy className="w-4 h-4 mr-2" />
              复制到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {menuItems.map((folder) => (
                <ContextMenuItem
                  key={folder.id === null ? 'root' : folder.id}
                  onClick={() => handleCopyFile(folder.id)}
                  style={{ paddingLeft: `${(folder.sortOrder === -1 ? 0 : folder.sortOrder || 0) * 12 + 8}px` }}
                >
                  {folder.sortOrder === -1 ? '📁 ' + folder.name : folder.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="w-4 h-4 mr-2" />
              移动到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {menuItems.map((folder) => (
                <ContextMenuItem
                  key={folder.id === null ? 'root' : folder.id}
                  onClick={() => handleMoveFile(folder.id)}
                  style={{ paddingLeft: `${(folder.sortOrder === -1 ? 0 : folder.sortOrder || 0) * 12 + 8}px` }}
                >
                  {folder.sortOrder === -1 ? '📁 ' + folder.name : folder.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={handleDeleteFile}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* 底部信息栏 */}
      <div className="px-4 py-1 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border text-xs flex items-center justify-between">
        <div
          className="flex min-w-0 items-center gap-2 cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={handleExternalDragStart}
          title="拖拽到外部应用"
        >
          <FileTypeIcon ext={currentFile.ext} className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="truncate text-gray-600 dark:text-gray-400">{currentFile.name}</span>
        </div>
        <span className="text-gray-500 dark:text-gray-500">{previewMeta} · {formatSize(currentFile.size)}</span>
      </div>

      {/* 底部缩略图条 */}
      <div className="h-20 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border flex items-center px-4 gap-2 overflow-x-auto">
        <button
          onClick={goToPrev}
          disabled={!canGoPrev}
          className={`flex-shrink-0 p-1 rounded ${canGoPrev ? 'hover:bg-gray-200 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'}`}
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 flex items-center gap-1 overflow-x-auto py-1">
          {previewFiles.map((file, index) => (
            <button
              key={file.id}
              onClick={() => setPreviewIndex(index)}
              className={`flex-shrink-0 w-14 h-14 rounded overflow-hidden transition-all ${
                index === previewIndex
                  ? 'ring-2 ring-white'
                  : 'opacity-50 hover:opacity-80'
              }`}
            >
              <ThumbnailItem file={file} />
            </button>
          ))}
        </div>

        <button
          onClick={goToNext}
          disabled={!canGoNext}
          className={`flex-shrink-0 p-1 rounded ${canGoNext ? 'hover:bg-gray-200 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'}`}
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )

  if (isFullscreen && typeof document !== 'undefined') {
    return createPortal(previewShell, document.body)
  }

  return previewShell
}

// 缩略图组件
function ThumbnailItem({ file }: { file: FileItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const previewType = getFilePreviewMode(file.ext)

  useEffect(() => {
    let mounted = true
    setSrc(null)

    if (previewType !== 'image' && previewType !== 'video') {
      return () => {
        mounted = false
      }
    }

    const loader = previewType === 'video' ? getVideoThumbnailSrc(file.path) : getFileSrc(file.path)

    loader.then(imageSrc => {
      if (mounted) setSrc(imageSrc)
    })
    return () => { mounted = false }
  }, [file.path, previewType])

  if (!src || (previewType !== 'image' && previewType !== 'video')) {
    return (
      <div className="h-full w-full bg-gray-900/90">
        <UnsupportedThumbnail ext={file.ext} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={file.name}
      className="w-full h-full object-cover"
    />
  )
}

function getPreviewMetaText(file: FileItem) {
  if (file.width > 0 && file.height > 0) {
    return `${file.width} x ${file.height}`
  }

  return file.ext.toUpperCase()
}

function UnsupportedPreviewState({
  file,
  onOpenFile,
}: {
  file: FileItem
  onOpenFile: () => Promise<void>
}) {
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white/90 px-8 py-10 text-center shadow-lg dark:border-dark-border dark:bg-dark-surface">
      <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gray-100 dark:bg-dark-bg">
        <FileTypeIcon ext={file.ext} className="h-12 w-12" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-medium text-gray-800 dark:text-gray-100">{file.name}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">此文件暂不支持内置预览</p>
      </div>
      <button
        onClick={() => void onOpenFile()}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
      >
        使用默认应用打开
      </button>
    </div>
  )
}

function TextPreviewPane({ content }: { content: string }) {
  return (
    <div className="flex h-full w-full max-w-5xl justify-center">
      <div className="h-full w-full overflow-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-lg dark:border-dark-border dark:bg-dark-surface">
        <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-gray-800 dark:text-gray-100">
          {content || '空文本文件'}
        </pre>
      </div>
    </div>
  )
}

function UnsupportedThumbnail({ ext }: { ext: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300">
      <FileTypeIcon ext={ext} className="h-5 w-5" />
      <span className="text-[9px] font-medium">{ext.toUpperCase()}</span>
    </div>
  )
}
