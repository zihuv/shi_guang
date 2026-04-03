import { useState, useEffect } from 'react'
import { useFileStore } from '@/stores/fileStore'
import { Button } from '@/components/ui/Button'
import FileTypeIcon from '@/components/FileTypeIcon'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Trash2, RotateCcw, X, AlertTriangle } from 'lucide-react'
import { getFilePreviewMode, getFileSrc } from '@/utils'

type TrashPanelProps = {
  variant?: 'sidebar' | 'header'
}

interface TrashFileItemProps {
  file: {
    id: number
    name: string
    ext: string
    size: number
    path: string
    deletedAt?: string | null
  }
  isSelected: boolean
  onToggleSelect: () => void
  formatFileSize: (bytes: number) => string
  formatDate: (dateStr: string | null | undefined) => string
}

function TrashFileItem({ file, isSelected, onToggleSelect, formatFileSize, formatDate }: TrashFileItemProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const previewType = getFilePreviewMode(file.ext)

  useEffect(() => {
    let mounted = true
    setImageSrc(null)
    setImageError(false)

    if (previewType !== 'image') {
      return () => { mounted = false }
    }

    getFileSrc(file.path).then(src => {
      if (mounted) setImageSrc(src)
    })
    return () => { mounted = false }
  }, [file.path, previewType])

  return (
    <div
      className={`relative group cursor-pointer rounded-lg border-2 transition-colors ${
        isSelected
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-transparent hover:border-gray-200 dark:hover:border-dark-border'
      }`}
      onClick={onToggleSelect}
    >
      <div className="aspect-square bg-gray-100 dark:bg-dark-bg rounded-lg overflow-hidden">
        {imageSrc && !imageError ? (
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <FileTypeIcon ext={file.ext} className="h-10 w-10" />
            <span className="text-xs font-medium text-gray-400">{file.ext.toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm text-gray-700 dark:text-gray-300 truncate" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatFileSize(file.size)}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          删除于 {formatDate(file.deletedAt)}
        </p>
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-primary-500 rounded-full flex items-center justify-center">
          <span className="text-white text-xs">✓</span>
        </div>
      )}
    </div>
  )
}

export default function TrashPanel({ variant = 'sidebar' }: TrashPanelProps) {
  const {
    trashFiles,
    trashCount,
    loadTrashFiles,
    loadTrashCount,
    restoreFiles,
    permanentDeleteFiles,
    emptyTrash,
  } = useFileStore()

  const [selectedTrashFiles, setSelectedTrashFiles] = useState<number[]>([])
  const [showTrashView, setShowTrashView] = useState(false)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

  // Load trash count on mount
  useEffect(() => {
    loadTrashCount()
  }, [loadTrashCount])

  const handleOpenTrash = async () => {
    await loadTrashFiles()
    setShowTrashView(true)
    setSelectedTrashFiles([])
  }

  const handleCloseTrash = () => {
    setShowTrashView(false)
    setSelectedTrashFiles([])
  }

  const handleToggleSelect = (fileId: number) => {
    if (selectedTrashFiles.includes(fileId)) {
      setSelectedTrashFiles(selectedTrashFiles.filter(id => id !== fileId))
    } else {
      setSelectedTrashFiles([...selectedTrashFiles, fileId])
    }
  }

  const handleSelectAll = () => {
    if (selectedTrashFiles.length === trashFiles.length) {
      setSelectedTrashFiles([])
    } else {
      setSelectedTrashFiles(trashFiles.map(f => f.id))
    }
  }

  const handleRestoreSelected = async () => {
    if (selectedTrashFiles.length > 0) {
      await restoreFiles(selectedTrashFiles)
      setSelectedTrashFiles([])
    }
  }

  const handlePermanentDeleteSelected = async () => {
    if (selectedTrashFiles.length > 0) {
      await permanentDeleteFiles(selectedTrashFiles)
      setSelectedTrashFiles([])
    }
  }

  const handleEmptyTrash = async () => {
    await emptyTrash()
    setShowEmptyConfirm(false)
  }

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const compactTrashCount = trashCount > 99 ? '99+' : String(trashCount)

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-border"
          onClick={handleOpenTrash}
          title={trashCount > 0 ? `回收站（${trashCount}）` : '回收站'}
          aria-label={trashCount > 0 ? `回收站，${trashCount} 个文件` : '回收站'}
        >
          <Trash2 className="h-4 w-4" />
          {trashCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white shadow-sm">
              {compactTrashCount}
            </span>
          )}
        </button>
      ) : (
        <div
          className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-100 dark:hover:bg-dark-border"
          onClick={handleOpenTrash}
        >
          <Trash2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">回收站</span>
          {trashCount > 0 && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-dark-border dark:text-gray-400">
              {trashCount}
            </span>
          )}
        </div>
      )}

      {/* Trash view dialog */}
      <Dialog open={showTrashView} onOpenChange={(isOpen) => !isOpen && handleCloseTrash()}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              回收站
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {trashFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
                <Trash2 className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-lg">回收站为空</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Toolbar */}
                <div className="flex items-center gap-2 pb-3 border-b border-gray-200 dark:border-dark-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    {selectedTrashFiles.length === trashFiles.length ? '取消全选' : '全选'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestoreSelected}
                    disabled={selectedTrashFiles.length === 0}
                  >
                    <RotateCcw className="w-4 h-4 mr-1" />
                    恢复
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePermanentDeleteSelected}
                    disabled={selectedTrashFiles.length === 0}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-4 h-4 mr-1" />
                    永久删除
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowEmptyConfirm(true)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    清空回收站
                  </Button>
                </div>

                {/* File list */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 py-3">
                  {trashFiles.map((file) => (
                    <TrashFileItem
                      key={file.id}
                      file={file}
                      isSelected={selectedTrashFiles.includes(file.id)}
                      onToggleSelect={() => handleToggleSelect(file.id)}
                      formatFileSize={formatFileSize}
                      formatDate={formatDate}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-dark-border">
            <Button variant="outline" onClick={handleCloseTrash}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Empty trash confirmation dialog */}
      <Dialog open={showEmptyConfirm} onOpenChange={(isOpen) => !isOpen && setShowEmptyConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              确认清空回收站
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-gray-700 dark:text-gray-300">
              确定要清空回收站吗？此操作不可恢复，所有文件将被永久删除。
            </p>
            <p className="text-sm text-gray-500 mt-2">
              回收站中共有 {trashFiles.length} 个文件
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmptyConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleEmptyTrash}>
              确认清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
