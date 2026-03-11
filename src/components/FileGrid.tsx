import { useEffect, useState, useMemo } from 'react'
import { useFileStore, FileItem } from '../stores/fileStore'
import { useTagStore } from '../stores/tagStore'
import { readFile } from '@tauri-apps/plugin-fs'

// Helper to get image URL from file path using fs plugin
async function getImageSrc(path: string): Promise<string> {
  try {
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
  const { files, selectedFile, setSelectedFile, isLoading } = useFileStore()
  const { selectedTagId } = useTagStore()
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    if (selectedTagId) {
      setFilteredFiles(files.filter(f => f.tags.some(t => t.id === selectedTagId)))
    } else {
      setFilteredFiles(files)
    }
  }, [files, selectedTagId])

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
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {filteredFiles.length} 个文件
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-gray-200 dark:bg-dark-border' : 'hover:bg-gray-100 dark:hover:bg-dark-border'}`}
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-gray-200 dark:bg-dark-border' : 'hover:bg-gray-100 dark:hover:bg-dark-border'}`}
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {filteredFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                isSelected={selectedFile?.id === file.id}
                onClick={() => setSelectedFile(file)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredFiles.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                isSelected={selectedFile?.id === file.id}
                onClick={() => setSelectedFile(file)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedFile && (
        <FileDetailPanel
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </div>
  )
}

function FileCard({ file, isSelected, onClick }: { file: FileItem; isSelected: boolean; onClick: () => void }) {
  const { files } = useFileStore()
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

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
    <div
      onClick={onClick}
      className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all ${
        isSelected
          ? 'ring-2 ring-primary-500 shadow-lg'
          : 'hover:shadow-md hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
      }`}
    >
      <div className="aspect-square bg-gray-100 dark:bg-dark-bg">
        {imageSrc === null ? (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        ) : imageSrc && !imageError ? (
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-2 bg-white dark:bg-dark-surface">
        <p className="text-xs text-gray-700 dark:text-gray-200 truncate">{file.name}</p>
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
  )
}

function FileRow({ file, isSelected, onClick }: { file: FileItem; isSelected: boolean; onClick: () => void }) {
  const { files } = useFileStore()
  const [imageError, setImageError] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)

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
    <div
      onClick={onClick}
      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-primary-50 dark:bg-primary-900/20'
          : 'hover:bg-gray-100 dark:hover:bg-dark-border'
      }`}
    >
      <div className="w-10 h-10 rounded bg-gray-100 dark:bg-dark-bg flex-shrink-0 overflow-hidden">
        {imageSrc === null ? (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        ) : imageSrc && !imageError ? (
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{file.name}</p>
        <p className="text-xs text-gray-400">{file.width} x {file.height}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
        <span className="text-xs text-gray-400">{file.ext.toUpperCase()}</span>
      </div>
    </div>
  )
}

function FileDetailPanel({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const { addTagToFile, removeTagFromFile, deleteFile } = useFileStore()
  const { tags } = useTagStore()
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [imageSrc, setImageSrc] = useState<string>('')

  useEffect(() => {
    let mounted = true
    getImageSrc(file.path).then(src => {
      if (mounted) setImageSrc(src)
    })
    return () => { mounted = false }
  }, [file.path])

  const fileTags = file.tags
  const availableTags = tags.filter(t => !fileTags.some(ft => ft.id === t.id))

  const handleDelete = async () => {
    await deleteFile(file.id)
  }

  return (
    <div className="fixed right-0 top-0 h-full w-72 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border shadow-xl flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-dark-border">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">详情</h3>
        <div className="flex items-center gap-1">
          {showDeleteConfirm ? (
            <>
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded"
              >
                确认删除
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                title="删除文件"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-dark-border">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="aspect-video bg-gray-100 dark:bg-dark-bg rounded-lg overflow-hidden">
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full h-full object-contain"
          />
        </div>

        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">文件名</h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 break-all">{file.name}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">尺寸</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.width} x {file.height}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">大小</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{formatSize(file.size)}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">格式</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.ext.toUpperCase()}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">修改时间</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.modifiedAt}</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">标签</h4>
            <button
              onClick={() => setShowTagPicker(!showTagPicker)}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              添加标签
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {fileTags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
                <button
                  onClick={() => removeTagFromFile(file.id, tag.id)}
                  className="hover:opacity-70"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            {fileTags.length === 0 && (
              <p className="text-xs text-gray-400">暂无标签</p>
            )}
          </div>

          {showTagPicker && availableTags.length > 0 && (
            <div className="mt-2 p-2 bg-gray-50 dark:bg-dark-bg rounded-lg space-y-1">
              {availableTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => {
                    addTagToFile(file.id, tag.id)
                    setShowTagPicker(false)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-gray-200 dark:hover:bg-dark-border"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="text-gray-700 dark:text-gray-300">{tag.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
