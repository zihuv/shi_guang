import { useEffect, useState } from 'react'
import { useFileStore, FileItem } from '@/stores/fileStore'
import { useTagStore } from '@/stores/tagStore'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
import { readFile, exists } from '@tauri-apps/plugin-fs'

// Helper to get image URL from file path
async function getImageSrc(path: string): Promise<string> {
  try {
    const fileExists = await exists(path)
    if (!fileExists) {
      return ''
    }
    const contents = await readFile(path)
    const blob = new Blob([contents])
    return URL.createObjectURL(blob)
  } catch (e: any) {
    if (e?.message?.includes('No such file or directory')) {
      return ''
    }
    console.error('Failed to read file:', e)
    return ''
  }
}

// Find folder by ID in the folder tree
function findFolderById(folders: FolderNode[], id: number): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder
    }
    const found = findFolderById(folder.children, id)
    if (found) {
      return found
    }
  }
  return null
}

export default function DetailPanel() {
  const { selectedFile } = useFileStore()
  const { folders, selectedFolderId } = useFolderStore()

  // Find the selected folder
  const selectedFolder = selectedFolderId ? findFolderById(folders, selectedFolderId) : null

  // Show empty state when nothing is selected
  if (!selectedFile && !selectedFolder) {
    return (
      <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col items-center justify-center p-6">
        <svg className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          选择文件或文件夹查看详情
        </p>
      </div>
    )
  }

  // Show file details when a file is selected (takes priority over folder)
  if (selectedFile) {
    return <FileDetailPanel file={selectedFile} />
  }

  // Show folder details when no file is selected
  if (selectedFolder) {
    return <FolderDetailPanel folder={selectedFolder} />
  }

  return null
}

function FolderDetailPanel({ folder }: { folder: FolderNode }) {
  const { deleteFolder: deleteFolderFn } = useFolderStore()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDelete = async () => {
    await deleteFolderFn(folder.id)
    setShowDeleteConfirm(false)
  }

  return (
    <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-dark-border">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">文件夹详情</h3>
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
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title="删除文件夹"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Folder icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
            <svg className="w-10 h-10 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          </div>
        </div>

        {/* Folder name */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">文件夹名称</h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 break-all">{folder.name}</p>
        </div>

        {/* File count */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">文件数量</h4>
          <p className="text-sm text-gray-800 dark:text-gray-200">{folder.fileCount} 个文件</p>
        </div>

        {/* Path */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">路径</h4>
          <p className="text-xs text-gray-800 dark:text-gray-200 break-all">{folder.path}</p>
        </div>
      </div>
    </div>
  )
}

function FileDetailPanel({ file }: { file: FileItem }) {
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
    <div className="w-72 flex-shrink-0 bg-white dark:bg-dark-surface border-l border-gray-200 dark:border-dark-border flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-dark-border">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">文件详情</h3>
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
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
              title="删除文件"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Preview image */}
        <div className="aspect-video bg-gray-100 dark:bg-dark-bg rounded-lg overflow-hidden">
          <img
            src={imageSrc}
            alt={file.name}
            className="w-full h-full object-contain"
          />
        </div>

        {/* File name */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">文件名</h4>
          <p className="text-sm text-gray-800 dark:text-gray-200 break-all">{file.name}</p>
        </div>

        {/* File info grid */}
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
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">创建时间</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.createdAt}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">修改时间</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.modifiedAt}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">导入时间</h4>
            <p className="text-sm text-gray-800 dark:text-gray-200">{file.importedAt}</p>
          </div>
        </div>

        {/* Tags */}
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
