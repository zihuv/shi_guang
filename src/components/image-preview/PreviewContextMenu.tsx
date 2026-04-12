import type { FolderNode } from '@/stores/folderStore'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/ContextMenu'
import { Copy, ExternalLink, FolderOpen, Move, Sparkles, Trash2 } from 'lucide-react'

interface PreviewContextMenuContentProps {
  flatFolders: Array<FolderNode & { sortOrder?: number }>
  canAnalyzeWithAi: boolean
  triggerMenuAction: (key: string, action: () => void | Promise<void>) => void
  onOpenFile: () => Promise<void>
  onShowInExplorer: () => Promise<void>
  onCopyFileToClipboard: () => Promise<void>
  onAnalyzeMetadata: () => Promise<void>
  onCopyFile: (targetFolderId: number | null) => Promise<void>
  onMoveFile: (targetFolderId: number | null) => Promise<void>
  onDeleteFile: () => Promise<void>
}

export function PreviewContextMenuContent({
  flatFolders,
  canAnalyzeWithAi,
  triggerMenuAction,
  onOpenFile,
  onShowInExplorer,
  onCopyFileToClipboard,
  onAnalyzeMetadata,
  onCopyFile,
  onMoveFile,
  onDeleteFile,
}: PreviewContextMenuContentProps) {
  return (
    <ContextMenuContent>
      <ContextMenuItem
        onSelect={() => triggerMenuAction('open', onOpenFile)}
        onClick={() => triggerMenuAction('open', onOpenFile)}
      >
        <ExternalLink className="mr-2 h-4 w-4" />
        默认应用打开
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => triggerMenuAction('explorer', onShowInExplorer)}
        onClick={() => triggerMenuAction('explorer', onShowInExplorer)}
      >
        <FolderOpen className="mr-2 h-4 w-4" />
        在资源管理器中显示
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => triggerMenuAction('clipboard', onCopyFileToClipboard)}
        onClick={() => triggerMenuAction('clipboard', onCopyFileToClipboard)}
      >
        <Copy className="mr-2 h-4 w-4" />
        复制到剪贴板
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!canAnalyzeWithAi}
        onSelect={() => triggerMenuAction('ai', onAnalyzeMetadata)}
        onClick={() => triggerMenuAction('ai', onAnalyzeMetadata)}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        AI 分析
      </ContextMenuItem>
      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Copy className="mr-2 h-4 w-4" />
          复制到
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {flatFolders.length > 0 ? (
            flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  triggerMenuAction(`copy:${folder.id}`, () => onCopyFile(folder.id))
                }}
                onSelect={() => triggerMenuAction(`copy:${folder.id}`, () => onCopyFile(folder.id))}
                onClick={() => triggerMenuAction(`copy:${folder.id}`, () => onCopyFile(folder.id))}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
              </ContextMenuItem>
            ))
          ) : (
            <ContextMenuItem disabled>暂无可用文件夹</ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Move className="mr-2 h-4 w-4" />
          移动到
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {flatFolders.length > 0 ? (
            flatFolders.map((folder) => (
              <ContextMenuItem
                key={folder.id}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  triggerMenuAction(`move:${folder.id}`, () => onMoveFile(folder.id))
                }}
                onSelect={() => triggerMenuAction(`move:${folder.id}`, () => onMoveFile(folder.id))}
                onClick={() => triggerMenuAction(`move:${folder.id}`, () => onMoveFile(folder.id))}
                style={{ paddingLeft: `${(folder.sortOrder || 0) * 12 + 8}px` }}
              >
                {folder.name}
              </ContextMenuItem>
            ))
          ) : (
            <ContextMenuItem disabled>暂无可用文件夹</ContextMenuItem>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => triggerMenuAction('delete', onDeleteFile)}
        onClick={() => triggerMenuAction('delete', onDeleteFile)}
        className="text-red-600 dark:text-red-400"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        删除
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
