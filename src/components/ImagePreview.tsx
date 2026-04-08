import { useEffect, useLayoutEffect, useState, useCallback, useRef, type MouseEvent as ReactMouseEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import type { FileItem } from '@/stores/fileTypes'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
import { useLibraryQueryStore } from '@/stores/libraryQueryStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTrashStore } from '@/stores/trashStore'
import { copyFilesToClipboard } from '@/lib/clipboard'
import { startExternalFileDrag } from '@/lib/externalDrag'
import { updateFileDimensions } from '@/services/tauri/files'
import { openFile, showInExplorer } from '@/services/tauri/system'
import FileTypeIcon from '@/components/FileTypeIcon'
import { buildAiImageDataUrl, formatSize, getFilePreviewMode, getFileSrc, getTextPreviewContent, getVideoThumbnailSrc, isPdfFile, isVideoFile } from '@/utils'
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
import { ExternalLink, FolderOpen, Copy, Move, Scan, Sparkles, Trash2, ZoomIn, ZoomOut } from 'lucide-react'

const AI_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'bmp',
  'gif',
  'tif',
  'tiff',
  'ico',
  'avif',
])

const MIN_ZOOM = 1
const MAX_ZOOM = 10000
const BUTTON_ZOOM_FACTOR = 1.2
const FIT_MODE_SNAP_EPSILON = 0.5
const BASE_WHEEL_ZOOM_SENSITIVITY = 0.002
const OVERLAY_BUTTON_CLASS = 'flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-30'
const OVERLAY_CHIP_CLASS = 'rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-white/70 backdrop-blur'
const IS_MACOS = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function ImagePreview() {
  const previewMode = usePreviewStore((state) => state.previewMode)
  const previewIndex = usePreviewStore((state) => state.previewIndex)
  const previewFiles = usePreviewStore((state) => state.previewFiles)
  const setPreviewIndex = usePreviewStore((state) => state.setPreviewIndex)
  const closePreview = usePreviewStore((state) => state.closePreview)
  const setSelectedFile = useSelectionStore((state) => state.setSelectedFile)
  const moveFiles = useLibraryQueryStore((state) => state.moveFiles)
  const copyFiles = useLibraryQueryStore((state) => state.copyFiles)
  const analyzeFileMetadata = useLibraryQueryStore((state) => state.analyzeFileMetadata)
  const deleteFile = useTrashStore((state) => state.deleteFile)

  const { folders, selectedFolderId } = useFolderStore()
  const previewTrackpadZoomSpeed = useSettingsStore((state) => state.previewTrackpadZoomSpeed)

  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string>("")
  const [imageError, setImageError] = useState(false)
  const [zoom, setZoom] = useState<number | 'auto'>('auto')  // 'auto' = 适应视图, 其他数字 = 手动缩放比例
  const [isLoading, setIsLoading] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [loadedImageSize, setLoadedImageSize] = useState({ width: 0, height: 0 })

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const lastMenuActionRef = useRef<{ key: string; timestamp: number } | null>(null)
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
  const persistedDimensionsRef = useRef<Record<number, string>>({})

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
  const canAnalyzeWithAi = currentFile ? AI_IMAGE_EXTENSIONS.has(currentFile.ext.toLowerCase()) : false
  const supportsZoom = previewType === 'image'
  const wheelZoomSensitivity = BASE_WHEEL_ZOOM_SENSITIVITY * previewTrackpadZoomSpeed

  const handleCopyFileToClipboard = useCallback(async () => {
    try {
      await copyFilesToClipboard([currentFile.id])
    } catch (e) {
      console.error('Failed to copy file to clipboard:', e)
    }
  }, [currentFile])

  const handleAnalyzeMetadata = async () => {
    if (!currentFile || !canAnalyzeWithAi) {
      toast.error('当前仅支持对图片执行 AI 分析')
      return
    }

    const loadingToast = toast.loading('AI 分析中...')
    try {
      const imageDataUrl = await buildAiImageDataUrl(currentFile.path)
      await analyzeFileMetadata(currentFile.id, imageDataUrl)
      toast.success('AI 已更新名称、标签和备注', { id: loadingToast })
    } catch (e) {
      console.error('Failed to analyze file metadata:', e)
      toast.error(`AI 分析失败: ${String(e)}`, { id: loadingToast })
    }
  }

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
      shouldCenterImageRef.current = false
      pendingScrollRef.current = null
      setZoom('auto')
      panStateRef.current = null
      setIsPanning(false)
    }

    lastPreviewFileIdRef.current = currentFile.id
  }, [currentFile])

  useEffect(() => {
    setLoadedImageSize({ width: 0, height: 0 })
  }, [currentFile?.id])

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

  useLayoutEffect(() => {
    const container = viewportRef.current
    if (!container) {
      previousZoomRef.current = zoom
      return
    }

    if (zoom === 'auto') {
      pendingScrollRef.current = null
      container.scrollLeft = 0
      container.scrollTop = 0
      shouldCenterImageRef.current = false
      previousZoomRef.current = zoom
      return
    }

    const pendingScroll = pendingScrollRef.current
    if (pendingScroll) {
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)

      container.scrollLeft = clampValue(pendingScroll.left, 0, maxScrollLeft)
      container.scrollTop = clampValue(pendingScroll.top, 0, maxScrollTop)
      pendingScrollRef.current = null
      shouldCenterImageRef.current = false
      previousZoomRef.current = zoom
      return
    }

    if (previousZoomRef.current === 'auto' || shouldCenterImageRef.current) {
      container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2)
      container.scrollTop = Math.max(0, (container.scrollHeight - container.clientHeight) / 2)
      shouldCenterImageRef.current = false
    }

    previousZoomRef.current = zoom
  }, [zoom, previewIndex, isFullscreen, viewportSize.width, viewportSize.height])

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

  // 打开文件
  const handleOpenFile = async () => {
    try {
      await openFile(currentFile.id)
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  // 在资源管理器中显示
  const handleShowInExplorer = async () => {
    try {
      await showInExplorer(currentFile.id)
    } catch (e) {
      console.error('Failed to open directory:', e)
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

  const suppressExternalDragEvent = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleExternalDragMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (!IS_MACOS || event.button !== 0) {
      return
    }

    suppressExternalDragEvent(event)

    void startExternalFileDrag([currentFile.id]).catch((error) => {
      console.error('Failed to start external drag:', error)
      toast.error('拖拽到外部应用失败')
    })
  }

  const getExternalDragProps = () => {
    if (IS_MACOS) {
      return {
        onMouseDown: handleExternalDragMouseDown,
        onClick: suppressExternalDragEvent,
      }
    }

    return {
      draggable: true,
      onDragStart: handleExternalDragStart,
    }
  }

  const externalDragProps = getExternalDragProps()

  const triggerMenuAction = (key: string, action: () => void | Promise<void>) => {
    const now = Date.now()
    const lastAction = lastMenuActionRef.current
    if (lastAction && lastAction.key === key && now - lastAction.timestamp < 250) {
      return
    }

    lastMenuActionRef.current = { key, timestamp: now }
    void action()
  }

  // 复制到
  const handleCopyFile = async (targetFolderId: number | null) => {
    try {
      await copyFiles([currentFile.id], targetFolderId)
    } catch (e) {
      console.error('Failed to copy file:', e)
      toast.error(`复制文件失败: ${String(e)}`)
    }
  }

  // 移动到
  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await moveFiles([currentFile.id], targetFolderId)
    } catch (e) {
      console.error('Failed to move file:', e)
      toast.error(`移动文件失败: ${String(e)}`)
    }
  }

  // 删除文件
  const handleDeleteFile = async () => {
    try {
      await deleteFile(currentFile.id)
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
  const imageWidth =
    currentFile.width > 0
      ? currentFile.width
      : loadedImageSize.width > 0
        ? loadedImageSize.width
        : null
  const imageHeight =
    currentFile.height > 0
      ? currentFile.height
      : loadedImageSize.height > 0
        ? loadedImageSize.height
        : null
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

  const applyZoom = (
    nextZoomInput: number | ((currentZoom: number) => number),
    anchor?: { x: number; y: number },
  ) => {
    const container = viewportRef.current
    if (!container) return

    const anchorX = anchor?.x ?? container.clientWidth / 2
    const anchorY = anchor?.y ?? container.clientHeight / 2
    const currentScrollLeft = container.scrollLeft
    const currentScrollTop = container.scrollTop

    setZoom(prevZoom => {
      const baseZoom = prevZoom === 'auto' ? fitZoomPercent : prevZoom
      const nextZoom = clampZoom(
        typeof nextZoomInput === 'function' ? nextZoomInput(baseZoom) : nextZoomInput,
      )

      if (nextZoom <= fitZoomPercent + FIT_MODE_SNAP_EPSILON) {
        pendingScrollRef.current = null
        shouldCenterImageRef.current = false
        return 'auto'
      }

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
          (currentScrollLeft + anchorX - currentImageOffsetLeft) / currentScale,
          0,
          imageWidth,
        )
        const imageCoordinateY = clampValue(
          (currentScrollTop + anchorY - currentImageOffsetTop) / currentScale,
          0,
          imageHeight,
        )

        pendingScrollRef.current = {
          left: nextImageOffsetLeft + imageCoordinateX * nextScale - anchorX,
          top: nextImageOffsetTop + imageCoordinateY * nextScale - anchorY,
        }
      } else {
        shouldCenterImageRef.current = true
      }

      return Math.round(nextZoom * 100) / 100
    })
  }

  const handleZoomOut = () => {
    applyZoom(currentZoom => currentZoom / BUTTON_ZOOM_FACTOR)
  }

  const handleZoomIn = () => {
    applyZoom(currentZoom => currentZoom * BUTTON_ZOOM_FACTOR)
  }

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev)
  }

  const handleNativeWheel = useCallback((event: WheelEvent) => {
    if (!supportsZoom) return
    if (!event.ctrlKey && !event.metaKey) return

    event.preventDefault()
    const container = viewportRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const deltaY =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY

    applyZoom(
      currentZoom => currentZoom * Math.exp(-deltaY * wheelZoomSensitivity),
      { x: pointerX, y: pointerY },
    )
  }, [applyZoom, supportsZoom, wheelZoomSensitivity])

  useEffect(() => {
    const container = viewportRef.current
    if (!container) {
      return
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleNativeWheel)
    }
  }, [handleNativeWheel, isFullscreen, previewMode, previewIndex])

  const hydrateCurrentFileDimensions = useCallback((width: number, height: number) => {
    if (!currentFile || width <= 0 || height <= 0) {
      return
    }

    setLoadedImageSize((current) => {
      if (current.width === width && current.height === height) {
        return current
      }
      return { width, height }
    })

    if (currentFile.width === width && currentFile.height === height) {
      return
    }

    const patch = { width, height }

    usePreviewStore.setState((state) => ({
      previewFiles: state.previewFiles.map((file) =>
        file.id === currentFile.id ? { ...file, ...patch } : file,
      ),
    }))

    useLibraryQueryStore.setState((state) => ({
      files: state.files.map((file) =>
        file.id === currentFile.id ? { ...file, ...patch } : file,
      ),
    }))

    const { selectedFile } = useSelectionStore.getState()
    if (selectedFile?.id === currentFile.id) {
      useSelectionStore.getState().setSelectedFile({
        ...selectedFile,
        ...patch,
      })
    }

    const persistedKey = `${width}x${height}`
    if (
      (currentFile.width <= 0 || currentFile.height <= 0) &&
      persistedDimensionsRef.current[currentFile.id] !== persistedKey
    ) {
      persistedDimensionsRef.current[currentFile.id] = persistedKey
      void updateFileDimensions({
        fileId: currentFile.id,
        width,
        height,
      }).catch((error) => {
        console.error('Failed to persist file dimensions:', error)
        delete persistedDimensionsRef.current[currentFile.id]
      })
    }
  }, [currentFile])

  const handleImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget
    hydrateCurrentFileDimensions(target.naturalWidth, target.naturalHeight)
  }, [hydrateCurrentFileDimensions])

  const finishPan = (pointerId: number) => {
    const container = viewportRef.current
    if (container?.hasPointerCapture(pointerId)) {
      container.releasePointerCapture(pointerId)
    }
    panStateRef.current = null
    setIsPanning(false)
  }

  const handleFitToView = () => {
    const panState = panStateRef.current
    if (panState) {
      finishPan(panState.pointerId)
    }

    pendingScrollRef.current = null
    shouldCenterImageRef.current = false
    setZoom('auto')
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
  const previewMeta = getPreviewMetaText(currentFile, loadedImageSize)
  const renderedPreviewContent = isLoading ? (
    <div className="flex h-full min-h-full items-center justify-center p-4">
      <svg className="h-10 w-10 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
  ) : imageError ? (
    <div className="flex h-full min-h-full flex-col items-center justify-center p-4 text-gray-400">
      <svg className="mb-2 h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          className={`${isFullscreen ? 'max-w-6xl shadow-2xl' : 'max-w-5xl shadow-lg'} max-h-full w-full rounded-lg bg-black`}
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
      isFitMode || scaledImageWidth === null || scaledImageHeight === null ? (
        <div className="flex h-full min-h-full items-center justify-center p-4">
          <img
            src={imageSrc}
            alt={currentFile.name}
            className="max-h-full max-w-full cursor-grab select-none object-contain active:cursor-grabbing"
            onLoad={handleImageLoad}
            {...externalDragProps}
          />
        </div>
      ) : (
        <div
          className="grid place-items-center"
          style={{
            width: `${scaledImageWidth}px`,
            height: `${scaledImageHeight}px`,
            minWidth: '100%',
            minHeight: '100%',
          }}
        >
          <img
            src={imageSrc}
            alt={currentFile.name}
            draggable={false}
            className="block select-none"
            onLoad={handleImageLoad}
            style={{
              width: `${scaledImageWidth}px`,
              height: `${scaledImageHeight}px`,
            }}
          />
        </div>
      )
    ) : null
  ) : null

  const previewContextMenu = (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => triggerMenuAction('open', handleOpenFile)} onClick={() => triggerMenuAction('open', handleOpenFile)}>
        <ExternalLink className="w-4 h-4 mr-2" />
        默认应用打开
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => triggerMenuAction('explorer', handleShowInExplorer)} onClick={() => triggerMenuAction('explorer', handleShowInExplorer)}>
        <FolderOpen className="w-4 h-4 mr-2" />
        在资源管理器中显示
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => triggerMenuAction('clipboard', handleCopyFileToClipboard)} onClick={() => triggerMenuAction('clipboard', handleCopyFileToClipboard)}>
        <Copy className="w-4 h-4 mr-2" />
        复制到剪贴板
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!canAnalyzeWithAi}
        onSelect={() => triggerMenuAction('ai', handleAnalyzeMetadata)}
        onClick={() => triggerMenuAction('ai', handleAnalyzeMetadata)}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        AI 分析
      </ContextMenuItem>
      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Copy className="w-4 h-4 mr-2" />
          复制到
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {flatFolders.length > 0 ? (
            flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return
                  }
                  triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id))
                }}
                onSelect={() => triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id))}
                onClick={() => triggerMenuAction(`copy:${folder.id}`, () => handleCopyFile(folder.id))}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
              </ContextMenuItem>
            ))
          ) : (
            <ContextMenuItem disabled>
              暂无可用文件夹
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Move className="w-4 h-4 mr-2" />
          移动到
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {flatFolders.length > 0 ? (
            flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return
                  }
                  triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id))
                }}
                onSelect={() => triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id))}
                onClick={() => triggerMenuAction(`move:${folder.id}`, () => handleMoveFile(folder.id))}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
              </ContextMenuItem>
            ))
          ) : (
            <ContextMenuItem disabled>
              暂无可用文件夹
            </ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => triggerMenuAction('delete', handleDeleteFile)}
        onClick={() => triggerMenuAction('delete', handleDeleteFile)}
        className="text-red-600 dark:text-red-400"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        删除
      </ContextMenuItem>
    </ContextMenuContent>
  )

  const fullscreenPreviewShell = (
    <div className="fixed inset-0 z-[80] bg-black text-white">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative h-full w-full">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-black/50 to-transparent" />

            <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
              {supportsZoom && (
                <>
                  <button
                    onClick={handleZoomOut}
                    className={OVERLAY_BUTTON_CLASS}
                    title="缩小"
                  >
                    <ZoomOut className="h-5 w-5" />
                  </button>
                  <button
                    onClick={handleZoomIn}
                    className={OVERLAY_BUTTON_CLASS}
                    title="放大"
                  >
                    <ZoomIn className="h-5 w-5" />
                  </button>
                  <button
                    onClick={handleFitToView}
                    className={OVERLAY_BUTTON_CLASS}
                    title="适应视图"
                    aria-pressed={isFitMode}
                  >
                    <Scan className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
              {totalFiles > 1 && (
                <span className={OVERLAY_CHIP_CLASS}>
                  {currentNum} / {totalFiles}
                </span>
              )}
              <button
                onClick={toggleFullscreen}
                className={OVERLAY_BUTTON_CLASS}
                title="退出全屏 (Esc)"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {totalFiles > 1 && (
              <>
                <button
                  onClick={goToPrev}
                  disabled={!canGoPrev}
                  className={`${OVERLAY_BUTTON_CLASS} absolute left-4 top-1/2 z-20 -translate-y-1/2`}
                  title="上一张"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={goToNext}
                  disabled={!canGoNext}
                  className={`${OVERLAY_BUTTON_CLASS} absolute right-4 top-1/2 z-20 -translate-y-1/2`}
                  title="下一张"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}

            <div
              ref={viewportRef}
              className={`preview-wheel-container h-full w-full overflow-auto ${canPanImage ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
              style={{ scrollbarGutter: 'stable' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {renderedPreviewContent}
            </div>
          </div>
        </ContextMenuTrigger>
        {previewContextMenu}
      </ContextMenu>
    </div>
  )

  const previewShell = (
    <div className="h-full flex flex-col bg-gray-100 dark:bg-dark-bg">
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-dark-surface border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center gap-4">
          <span className="text-sm">{currentFolderName}</span>
        </div>

        <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-2">
              <button
                onClick={handleZoomOut}
                className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="缩小"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={handleZoomIn}
                className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                title="放大"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <span className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 dark:bg-dark-border dark:text-gray-300">
              {previewType === 'video' ? '视频播放' : previewType === 'pdf' ? 'PDF 预览' : '文件预览'}
            </span>
          )}

          {previewType !== 'none' && (
            <>
              {supportsZoom && (
                <button
                  onClick={handleFitToView}
                  className="rounded p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="适应视图"
                  aria-pressed={isFitMode}
                >
                  <Scan className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="px-2 py-1 text-sm rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                title={isFullscreen ? '退出全屏 (F)' : '全屏预览 (F)'}
              >
                {isFullscreen ? '退出全屏' : '全屏'}
              </button>
            </>
          )}

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

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={viewportRef}
            className={`preview-wheel-container flex-1 overflow-auto ${canPanImage ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
            style={{ scrollbarGutter: 'stable' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {renderedPreviewContent}
          </div>
        </ContextMenuTrigger>
        {previewContextMenu}
      </ContextMenu>

      <div className="px-4 py-1 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border text-xs flex items-center justify-between">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left cursor-grab active:cursor-grabbing"
          {...externalDragProps}
        >
          <FileTypeIcon ext={currentFile.ext} className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="truncate text-gray-600 dark:text-gray-400">{currentFile.name}</span>
        </button>
        <span className="text-gray-500 dark:text-gray-500">{previewMeta} · {formatSize(currentFile.size)}</span>
      </div>

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
    return createPortal(fullscreenPreviewShell, document.body)
  }

  return previewShell
}

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

function getPreviewMetaText(
  file: FileItem,
  fallbackDimensions?: { width: number; height: number },
) {
  const width = file.width > 0 ? file.width : fallbackDimensions?.width ?? 0
  const height = file.height > 0 ? file.height : fallbackDimensions?.height ?? 0

  if (width > 0 && height > 0) {
    return `${width} x ${height}`
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
