import { useEffect } from 'react'
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
  children: React.ReactNode
}

export default function FileContextMenu({ file, children }: FileContextMenuProps) {
  const { deleteFile, loadFilesInFolder, setSelectedFile } = useFileStore()
  const { folders, loadFolders, selectedFolderId } = useFolderStore()

  // Load folders when component mounts
  useEffect(() => {
    loadFolders()
  }, [loadFolders])

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
      await invoke('copy_file', { fileId: file.id, targetFolderId })
      // Refresh current folder
      await loadFilesInFolder(selectedFolderId)
    } catch (e) {
      console.error('Failed to copy file:', e)
    }
  }

  // Move file to a folder
  const handleMoveFile = async (targetFolderId: number | null) => {
    try {
      await invoke('move_file', { fileId: file.id, targetFolderId })
      // Refresh current folder
      await loadFilesInFolder(selectedFolderId)
    } catch (e) {
      console.error('Failed to move file:', e)
    }
  }

  // Delete file
  const handleDeleteFile = async () => {
    try {
      await deleteFile(file.id)
      setSelectedFile(null)
    } catch (e) {
      console.error('Failed to delete file:', e)
    }
  }

  return (
    <ContextMenu>
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
            复制到
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onClick={() => handleCopyFile(folder.id)}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Move to submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Move className="w-4 h-4 mr-2" />
            移动到
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
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
