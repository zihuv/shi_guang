import { useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFileStore, FileItem } from '@/stores/fileStore'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
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

interface FileContextMenuProps {
  file: FileItem
  children: ReactNode
}

export default function FileContextMenu({ file, children }: FileContextMenuProps) {
  const { deleteFile, deleteFiles, setSelectedFile, selectedFiles, moveFiles, copyFiles } = useFileStore()
  const { folders } = useFolderStore()
  const [frozenFileIds, setFrozenFileIds] = useState<number[] | null>(null)
  const liveActiveFileIds = selectedFiles.includes(file.id) ? selectedFiles : [file.id]
  const activeFileIds = frozenFileIds ?? liveActiveFileIds

  // Flatten folder tree for display in submenu
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

  // Add root option at the beginning (for copy only)
  const copyMenuItems = [
    { id: null, name: '根目录', sortOrder: -1 as const },
    ...flatFolders
  ]

  // Open file with default application (using Rust backend)
  const handleOpenFile = async () => {
    try {
      await invoke('open_file', { fileId: file.id })
    } catch (e) {
      console.error('Failed to open file:', e)
    }
  }

  // Open file in file explorer (using Rust backend)
  const handleShowInExplorer = async () => {
    try {
      await invoke('show_in_explorer', { fileId: file.id })
    } catch (e) {
      console.error('Failed to open directory:', e)
    }
  }

  // Copy file to a folder
  const handleCopyFile = async (targetFolderId: number | null) => {
    try {
      await copyFiles(activeFileIds, targetFolderId)
    } catch (e) {
      console.error('Failed to copy file:', e)
    }
  }

  // Move file to a folder
  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await moveFiles(activeFileIds, targetFolderId)
    } catch (e) {
      console.error('Failed to move file:', e)
    }
  }

  // Delete file
  const handleDeleteFile = async () => {
    try {
      if (activeFileIds.length > 1) {
        await deleteFiles(activeFileIds)
        return
      }

      await deleteFile(activeFileIds[0] ?? file.id)
      setSelectedFile(null)
    } catch (e) {
      console.error('Failed to delete file:', e)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      const { selectedFiles: latestSelectedFiles } = useFileStore.getState()
      setFrozenFileIds(latestSelectedFiles.includes(file.id) ? [...latestSelectedFiles] : [file.id])
      return
    }

    setFrozenFileIds(null)
  }

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
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
        <ContextMenuSeparator />

        {/* Copy to submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Copy className="w-4 h-4 mr-2" />
            {activeFileIds.length > 1 ? `复制 ${activeFileIds.length} 个文件到` : '复制到'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {copyMenuItems.map((folder) => (
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

        {/* Move to submenu (no root option for files) */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Move className="w-4 h-4 mr-2" />
            {activeFileIds.length > 1 ? `移动 ${activeFileIds.length} 个文件到` : '移动到'}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onClick={() => handleMoveFile(folder.id)}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
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
          {activeFileIds.length > 1 ? `删除 ${activeFileIds.length} 个文件` : '删除'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
