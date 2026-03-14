import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
import { useFileStore } from '@/stores/fileStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/ContextMenu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/AlertDialog'
import { ChevronRight, Folder as FolderIcon, Plus, Trash2, Pencil, Globe } from 'lucide-react'

interface FolderItemProps {
  folder: FolderNode
  depth: number
}

function FolderItem({ folder, depth }: FolderItemProps) {
  const { selectedFolderId, expandedFolderIds, selectFolder, toggleFolder } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId, setSelectedFile } = useFileStore()
  const { setAddingSubfolder, setEditingFolder, setDeleteConfirm } = useFolderStore()
  const isExpanded = expandedFolderIds.includes(folder.id)
  const isSelected = selectedFolderId === folder.id
  const hasChildren = folder.children && folder.children.length > 0

  // dnd-kit useDroppable
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-${folder.id}`,
    data: { type: 'folder', folderId: folder.id, folderName: folder.name }
  })

  const handleClick = async () => {
    selectFolder(folder.id)
    setSelectedFolderId(folder.id)
    setSelectedFile(null)
    await loadFilesInFolder(folder.id)
  }

  const handleAddSubfolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    setAddingSubfolder(folder)
  }

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingFolder(folder)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteConfirm(folder)
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            data-folder-id={folder.id}
            className={`group flex items-center gap-1 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
              isSelected
                ? 'bg-primary-100 dark:bg-primary-900/30'
                : isOver
                  ? 'bg-blue-100 dark:bg-blue-900/30'
                  : 'hover:bg-gray-100 dark:hover:bg-dark-border'
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={handleClick}
          >
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFolder(folder.id)
                }}
              >
                <ChevronRight
                  className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
              </Button>
            ) : (
              <span className="w-5" />
            )}

            {folder.name === '浏览器采集' || folder.isSystem ? (
              <Globe className="w-4 h-4 text-blue-500 flex-shrink-0" />
            ) : (
              <FolderIcon className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            )}

            <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{folder.name}</span>

            {folder.fileCount > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{folder.fileCount}</span>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={handleAddSubfolder}>
            <Plus className="w-4 h-4 mr-2" />
            创建子文件夹
          </ContextMenuItem>
          <ContextMenuItem onClick={handleRename}>
            <Pencil className="w-4 h-4 mr-2" />
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} className="text-red-600">
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <div>
          {folder.children.map((child) => (
            <FolderItem key={child.id} folder={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function FolderTree() {
  const {
    folders,
    selectedFolderId,
    isLoading,
    loadFolders,
    createFolder,
    selectFolder,
    addingSubfolder,
    editingFolder,
    deleteConfirm,
    setAddingSubfolder,
    setEditingFolder,
    setDeleteConfirm,
    setNewFolderName,
    newFolderName,
  } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId } = useFileStore()
  const [isAdding, setIsAdding] = useState(false)

  const handleAddFolder = async () => {
    if (newFolderName.trim()) {
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

  const handleRenameSubmit = async () => {
    if (editingFolder && newFolderName.trim()) {
      const store = useFolderStore.getState()
      await store.renameFolder(editingFolder.id, newFolderName.trim())
      setEditingFolder(null)
      setNewFolderName('')
    }
  }

  const handleConfirmDelete = async () => {
    if (deleteConfirm) {
      const deletedId = deleteConfirm.id
      setDeleteConfirm(null)

      await import('@tauri-apps/api/core').then(m => m.invoke('delete_folder', { id: deletedId }))
      await loadFolders()

      if (selectedFolderId === deletedId) {
        const { folders } = useFolderStore.getState()
        if (folders.length > 0) {
          const firstFolder = folders[0]
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

  return (
    <div className="flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">文件夹</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div
        id="folder-tree-container"
        className="flex-1 overflow-auto p-2"
      >
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
              <FolderItem key={folder.id} folder={folder} depth={0} />
            ))}

            {folders.length === 0 && (
              <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                暂无文件夹
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Folder Dialog */}
      <Dialog open={isAdding} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setIsAdding(false)
          setNewFolderName('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
              placeholder="文件夹名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setIsAdding(false)
              setNewFolderName('')
            }}>
              取消
            </Button>
            <Button onClick={handleAddFolder}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Subfolder Dialog */}
      <Dialog open={!!addingSubfolder} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setAddingSubfolder(null)
          setNewFolderName('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建子文件夹</DialogTitle>
            <DialogDescription>
              在 "{addingSubfolder?.name}" 下创建子文件夹
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubfolderSubmit()}
              placeholder="子文件夹名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setAddingSubfolder(null)
              setNewFolderName('')
            }}>
              取消
            </Button>
            <Button onClick={handleAddSubfolderSubmit}>创建</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!editingFolder} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setEditingFolder(null)
          setNewFolderName('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
              placeholder="新名称"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setEditingFolder(null)
              setNewFolderName('')
            }}>
              取消
            </Button>
            <Button onClick={handleRenameSubmit}>确定</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setDeleteConfirm(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除文件夹 "{deleteConfirm?.name}" 吗？删除后文件夹中的文件不会被删除，但会变成未分类状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
