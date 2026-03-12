import { useEffect, useState, useCallback } from 'react'
import { useFileStore, FileItem } from '@/stores/fileStore'
import { readFile } from '@tauri-apps/plugin-fs'
import { useFolderStore } from '@/stores/folderStore'

// 获取图片 src
async function getImageSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path)
    const blob = new Blob([contents])
    return URL.createObjectURL(blob)
  } catch (e) {
    console.error('Failed to read file:', e)
    return ''
  }
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function ImagePreview() {
  const {
    previewMode,
    previewIndex,
    previewFiles,
    setPreviewIndex,
    closePreview,
    setSelectedFile
  } = useFileStore()

  const { folders, selectedFolderId } = useFolderStore()

  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [zoom, setZoom] = useState<number | 'auto'>('auto')  // 'auto' = 适应窗口, 100 = 原始尺寸, 其他数字 = 缩放比例
  const [isLoading, setIsLoading] = useState(true)

  // 获取当前文件夹名称
  const currentFolderName = selectedFolderId
    ? folders.find(f => f.id === selectedFolderId)?.name || '未知文件夹'
    : '全部文件'

  // 当前文件
  const currentFile = previewFiles[previewIndex]

  // 切换预览时同步更新选中文件
  useEffect(() => {
    if (currentFile) {
      setSelectedFile(currentFile)
    }
  }, [previewIndex, currentFile, setSelectedFile])

  // 加载图片
  useEffect(() => {
    if (!currentFile) return

    let mounted = true
    setIsLoading(true)
    setImageError(false)

    getImageSrc(currentFile.path).then(src => {
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
  }, [currentFile?.path])

  // 清理 URL 对象
  useEffect(() => {
    return () => {
      if (imageSrc) {
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
          closePreview()
          break
        case 'ArrowLeft':
          goToPrev()
          break
        case 'ArrowRight':
          goToNext()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewMode, previewIndex, previewFiles.length])

  // 触控板缩放
  useEffect(() => {
    if (!previewMode) return

    const handleWheel = (e: WheelEvent) => {
      // 检测 ctrlKey 或 metaKey（macOS），判断是否为双指缩放手势
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()

      // deltaY < 0 表示放大，deltaY > 0 表示缩小
      const delta = e.deltaY < 0 ? 10 : -10

      setZoom(prevZoom => {
        if (prevZoom === 'auto') {
          // 从适应窗口模式开始，先切换到 100%，并应用初始增量
          return delta > 0 ? 110 : 90
        }

        const newZoom = prevZoom + delta
        // 限制在 10%-300% 范围内
        return Math.max(10, Math.min(300, newZoom))
      })
    }

    // 添加 passive: false 以允许阻止默认行为
    const container = document.querySelector('.preview-wheel-container')
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false })
      return () => container.removeEventListener('wheel', handleWheel)
    }

    // 如果没找到容器，添加到 window
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [previewMode])

  // 切换上一张
  const goToPrev = useCallback(() => {
    if (previewIndex > 0) {
      setPreviewIndex(previewIndex - 1)
      setZoom('auto')  // 切换图片时重置缩放
    }
  }, [previewIndex, setPreviewIndex])

  // 切换下一张
  const goToNext = useCallback(() => {
    if (previewIndex < previewFiles.length - 1) {
      setPreviewIndex(previewIndex + 1)
      setZoom('auto')  // 切换图片时重置缩放
    }
  }, [previewIndex, previewFiles.length, setPreviewIndex])

  // 判断是否为适应窗口模式（'auto' 表示适应窗口）
  const isFitMode = zoom === 'auto'

  // 处理缩放滑块
  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value)
    // 滑块位置 100 表示 100% 原始尺寸
    setZoom(value)
  }

  // 适应窗口
  const handleZoomFit = () => {
    setZoom('auto')
  }

  // 1:1 缩放
  const handleZoom100 = () => {
    setZoom(100)  // 100 也表示适应窗口（保持兼容）
  }

  // 点击大图切换（左边=上一张，右边=下一张）
  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const halfWidth = rect.width / 2

    if (x < halfWidth) {
      goToPrev()
    } else {
      goToNext()
    }
  }

  if (!previewMode || !currentFile) return null

  const totalFiles = previewFiles.length
  const currentNum = previewIndex + 1
  const canGoPrev = previewIndex > 0
  const canGoNext = previewIndex < totalFiles - 1

  return (
    <div className="h-full flex flex-col bg-gray-100 dark:bg-dark-bg">
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
          {/* 缩放滑块 */}
          <div className="flex items-center gap-2">
            <span className="text-sm w-12 text-right">
              {zoom === 'auto' ? '适应' : zoom === 100 ? '100%' : `${zoom}%`}
            </span>
            <input
              type="range"
              min="10"
              max="300"
              value={zoom === 'auto' ? 100 : zoom}
              onChange={handleZoomChange}
              className="w-24"
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
      <div
        className="preview-wheel-container flex-1 overflow-auto flex items-center justify-center p-4"
        onClick={handleImageClick}
      >
        {isLoading ? (
          <div className="flex items-center justify-center">
            <svg className="w-10 h-10 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : imageError ? (
          <div className="flex flex-col items-center text-gray-400">
            <svg className="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>无法加载图片</p>
          </div>
        ) : imageSrc ? (
          <img
            src={imageSrc}
            alt={currentFile.name}
            className={isFitMode ? 'max-w-full max-h-full object-contain' : 'max-w-none transition-transform duration-150'}
            style={isFitMode ? {} : { transform: `scale(${zoom / 100})` }}
          />
        ) : null}
      </div>

      {/* 底部信息栏 */}
      <div className="px-4 py-1 bg-white dark:bg-dark-surface border-t border-gray-200 dark:border-dark-border text-xs flex items-center justify-between">
        <span className="text-gray-600 dark:text-gray-400">{currentFile.name}</span>
        <span className="text-gray-500 dark:text-gray-500">{currentFile.width} x {currentFile.height} · {formatSize(currentFile.size)}</span>
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
}

// 缩略图组件
function ThumbnailItem({ file }: { file: FileItem }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    getImageSrc(file.path).then(imageSrc => {
      if (mounted) setSrc(imageSrc)
    })
    return () => { mounted = false }
  }, [file.path])

  if (!src) {
    return (
      <div className="w-full h-full bg-gray-800 flex items-center justify-center">
        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
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
