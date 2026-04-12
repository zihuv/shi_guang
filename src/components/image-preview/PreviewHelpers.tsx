import { useEffect, useState } from 'react'
import type { FileItem } from '@/stores/fileTypes'
import FileTypeIcon from '@/components/FileTypeIcon'
import { getFilePreviewMode, getFileSrc, getVideoThumbnailSrc } from '@/utils'

export function ThumbnailItem({ file }: { file: FileItem }) {
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

    loader.then((imageSrc) => {
      if (mounted) {
        setSrc(imageSrc)
      }
    })

    return () => {
      mounted = false
    }
  }, [file.path, previewType])

  if (!src || (previewType !== 'image' && previewType !== 'video')) {
    return (
      <div className="h-full w-full bg-gray-900/90">
        <UnsupportedThumbnail ext={file.ext} />
      </div>
    )
  }

  return <img src={src} alt={file.name} className="h-full w-full object-cover" />
}

export function UnsupportedPreviewState({
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

export function TextPreviewPane({ content }: { content: string }) {
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

export function UnsupportedThumbnail({ ext }: { ext: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-gray-800 to-gray-900 text-gray-300">
      <FileTypeIcon ext={ext} className="h-5 w-5" />
      <span className="text-[9px] font-medium">{ext.toUpperCase()}</span>
    </div>
  )
}
