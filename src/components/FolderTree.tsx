import { useState, useRef, useEffect } from 'react'
import { useFolderStore, FolderNode } from '../stores/folderStore'
import { useFileStore } from '../stores/fileStore'

interface FolderItemProps {
  folder: FolderNode
  depth: number
  onContextMenu: (e: React.MouseEvent, folder: FolderNode) => void
}

function FolderItem({ folder, depth, onContextMenu }: FolderItemProps) {
  const { selectedFolderId, expandedFolderIds, selectFolder, toggleFolder } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId } = useFileStore()
  const isExpanded = expandedFolderIds.includes(folder.id)
  const isSelected = selectedFolderId === folder.id
  const hasChildren = folder.children && folder.children.length > 0

  const handleClick = async () => {
    selectFolder(folder.id)
    setSelectedFolderId(folder.id)
    await loadFilesInFolder(folder.id)
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
          isSelected
            ? 'bg-primary-100 dark:bg-primary-900/30'
            : 'hover:bg-gray-100 dark:hover:bg-dark-border'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, folder)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleFolder(folder.id)
            }}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
          >
            <svg
              className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-4" />
        )}

        <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>

        <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{folder.name}</span>

        {folder.fileCount > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">{folder.fileCount}</span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {folder.children.map((child) => (
            <FolderItem key={child.id} folder={child} depth={depth + 1} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree() {
  const { folders, selectedFolderId, loadFolders, createFolder, deleteFolder, renameFolder, selectFolder, isLoading } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId } = useFileStore()
  const [isAdding, setIsAdding] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: FolderNode } | null>(null)
  const [editingFolder, setEditingFolder] = useState<FolderNode | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<FolderNode | null>(null)
  const [addingSubfolder, setAddingSubfolder] = useState<FolderNode | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleContextMenu = (e: React.MouseEvent, folder: FolderNode) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, folder })
  }

  const handleRename = () => {
    if (contextMenu) {
      setEditingFolder(contextMenu.folder)
      setEditingName(contextMenu.folder.name)
      setContextMenu(null)
    }
  }

  const handleAddSubfolder = () => {
    if (contextMenu) {
      setAddingSubfolder(contextMenu.folder)
      setNewFolderName('')
      setContextMenu(null)
    }
  }

  const handleDelete = () => {
    if (contextMenu) {
      const folder = contextMenu.folder
      setContextMenu(null)

      // Check if this is the only root folder
      const { folders } = useFolderStore.getState()
      const rootFolderIds = folders.map(f => f.id)
      const isRootFolder = rootFolderIds.includes(folder.id)
      const isOnlyRootFolder = isRootFolder && folders.length === 1

      if (isOnlyRootFolder) {
        alert('根目录必须保留至少一个文件夹')
        return
      }

      // Show confirmation dialog
      setDeleteConfirm(folder)
    }
  }

  const handleConfirmDelete = async () => {
    if (deleteConfirm) {
      const deletedId = deleteConfirm.id
      setDeleteConfirm(null)

      // Delete folder and reload folders manually to ensure we get updated list
      const db = await import('@tauri-apps/api/core').then(m => m.invoke('delete_folder', { id: deletedId }))
      await loadFolders()

      // If deleted folder was selected, select the first remaining folder
      if (selectedFolderId === deletedId) {
        const { folders } = useFolderStore.getState()
        console.log('folders after delete:', folders)
        if (folders.length > 0) {
          const firstFolder = folders[0]
          console.log('selecting first folder:', firstFolder.name)
          selectFolder(firstFolder.id)
          setSelectedFolderId(firstFolder.id)
          await loadFilesInFolder(firstFolder.id)
        } else {
          setSelectedFolderId(null)
          await loadFilesInFolder(null)
        }
      }
    }
  }

  const handleRenameSubmit = async () => {
    if (editingFolder && editingName.trim()) {
      await renameFolder(editingFolder.id, editingName.trim())
      setEditingFolder(null)
      setEditingName('')
    }
  }

  const handleAddFolder = async () => {
    if (newFolderName.trim()) {
      // Top + button always creates root folder
      await createFolder(newFolderName.trim(), null)
      setNewFolderName('')
      setIsAdding(false)
    }
  }

  const handleAddSubfolderSubmit = async () => {
    if (newFolderName.trim() && addingSubfolder) {
      await createFolder(newFolderName.trim(), addingSubfolder.id)
      setNewFolderName('')
      setAddingSubfolder(null)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">文件夹</h2>
          <button
            onClick={() => setIsAdding(true)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-dark-border text-gray-500 dark:text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <div className="space-y-1">
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                depth={0}
                onContextMenu={handleContextMenu}
              />
            ))}

            {folders.length === 0 && (
              <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                暂无文件夹
              </div>
            )}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-white dark:bg-dark-surface border border-gray-200 dark:border-dark-border rounded-lg shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-2 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-border"
            onClick={handleAddSubfolder}
          >
            创建子文件夹
          </button>
          <button
            className="w-full px-4 py-2 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-border"
            onClick={handleRename}
          >
            重命名
          </button>
          <button
            className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={handleDelete}
          >
            删除
          </button>
        </div>
      )}

      {/* Add Folder Dialog */}
      {isAdding && (
        <div className="p-3 border-t border-gray-200 dark:border-dark-border">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
            placeholder="文件夹名称"
            className="w-full px-2 py-1.5 mb-2 text-sm bg-gray-100 dark:bg-dark-bg border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddFolder}
              className="flex-1 px-2 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              创建
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="flex-1 px-2 py-1.5 text-sm bg-gray-100 dark:bg-dark-border text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Add Subfolder Dialog */}
      {addingSubfolder && (
        <div className="p-3 border-t border-gray-200 dark:border-dark-border">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            在 "{addingSubfolder.name}" 下创建子文件夹
          </div>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSubfolderSubmit()}
            placeholder="子文件夹名称"
            className="w-full px-2 py-1.5 mb-2 text-sm bg-gray-100 dark:bg-dark-bg border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddSubfolderSubmit}
              className="flex-1 px-2 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              创建
            </button>
            <button
              onClick={() => setAddingSubfolder(null)}
              className="flex-1 px-2 py-1.5 text-sm bg-gray-100 dark:bg-dark-border text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {editingFolder && (
        <div className="p-3 border-t border-gray-200 dark:border-dark-border">
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
            placeholder="新名称"
            className="w-full px-2 py-1.5 mb-2 text-sm bg-gray-100 dark:bg-dark-bg border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleRenameSubmit}
              className="flex-1 px-2 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              确定
            </button>
            <button
              onClick={() => setEditingFolder(null)}
              className="flex-1 px-2 py-1.5 text-sm bg-gray-100 dark:bg-dark-border text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-dark-surface rounded-lg p-6 w-80 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              确认删除
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              确定要删除文件夹 "{deleteConfirm.name}" 吗？删除后文件夹中的文件不会被删除，但会变成未分类状态。
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                删除
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 text-sm bg-gray-100 dark:bg-dark-border text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
