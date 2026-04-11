import { useState, useEffect, useRef, useMemo } from 'react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { type Instruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import { buildVisibleTreeItems, useTreeKeyboardNavigation } from '@/hooks/useTreeKeyboardNavigation'
import {
  appPanelHeaderClass,
  appPanelMetaClass,
  appPanelTitleClass,
  appTreeRowClass,
} from '@/lib/ui'
import { requestFocusFirstFile } from '@/lib/libraryNavigation'
import { deleteFolder } from '@/services/tauri/folders'
import { showFolderInExplorer } from '@/services/tauri/system'
import { useFolderStore, FolderNode } from '@/stores/folderStore'
import { useFilterStore } from '@/stores/filterStore'
import { useLibraryQueryStore } from '@/stores/libraryQueryStore'
import { usePreviewStore } from '@/stores/previewStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import TrashPanel from '@/components/TrashPanel'
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
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
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
import { ChevronRight, Folder as FolderIcon, Plus, Trash2, Pencil, Globe, Move, FolderOpen, Files } from 'lucide-react'

const INTERNAL_FILE_DRAG_MIME = 'application/x-shiguang-file-ids'

// Helper functions for folder tree operations
const findFolderById = (folders: FolderNode[], folderId: number): FolderNode | null => {
  for (const folder of folders) {
    if (folder.id === folderId) return folder
    if (folder.children && folder.children.length > 0) {
      const found = findFolderById(folder.children, folderId)
      if (found) return found
    }
  }
  return null
}

const findFolderParentId = (folders: FolderNode[], folderId: number, parentId: number | null): number | null => {
  for (const folder of folders) {
    if (folder.id === folderId) return parentId
    if (folder.children && folder.children.length > 0) {
      const found = findFolderParentId(folder.children, folderId, folder.id)
      if (found !== null) return found
    }
  }
  return null
}

const findSiblings = (folders: FolderNode[], parentId: number | null): FolderNode[] => {
  if (parentId === null) return folders
  const findParent = (items: FolderNode[]): FolderNode[] | null => {
    for (const item of items) {
      if (item.id === parentId) return item.children || []
      if (item.children && item.children.length > 0) {
        const found = findParent(item.children)
        if (found) return found
      }
    }
    return null
  }
  return findParent(folders) || []
}

// Get all folder IDs in a tree for calculating global indices
const getAllFolderIds = (folders: FolderNode[]): number[] => {
  const ids: number[] = []
  for (const folder of folders) {
    ids.push(folder.id)
    if (folder.children && folder.children.length > 0) {
      ids.push(...getAllFolderIds(folder.children))
    }
  }
  return ids
}

// Check if a folder is a descendant of another
const isDescendant = (folders: FolderNode[], parentId: number, childId: number): boolean => {
  const parent = findFolderById(folders, parentId)
  if (!parent || !parent.children) return false

  const checkDescendant = (items: FolderNode[], targetId: number): boolean => {
    for (const item of items) {
      if (item.id === targetId) return true
      if (item.children && checkDescendant(item.children, targetId)) return true
    }
    return false
  }

  return checkDescendant(parent.children, childId)
}

async function selectFolderFromTree(folderId: number | null) {
  const folderStore = useFolderStore.getState()
  const filterStore = useFilterStore.getState()
  const libraryStore = useLibraryQueryStore.getState()
  const selectionStore = useSelectionStore.getState()
  const previewStore = usePreviewStore.getState()

  if (filterStore.isFilterPanelOpen || folderId === null) {
    filterStore.setFolderId(null)
  }

  if (folderStore.selectedFolderId === folderId) {
    selectionStore.clearSelection()
    previewStore.closePreview()
    if (selectionStore.selectedFile) {
      selectionStore.setSelectedFile(null)
    }
    return
  }

  folderStore.selectFolder(folderId)
  selectionStore.clearSelection()
  previewStore.closePreview()
  selectionStore.setSelectedFile(null)
  await libraryStore.loadFilesInFolder(folderId)
}

// Flatten folder tree for "Move to" submenu
const flattenFolders = (nodes: FolderNode[], depth = 0): (FolderNode & { sortOrder: number })[] => {
  let result: (FolderNode & { sortOrder: number })[] = []
  for (const node of nodes) {
    result.push({ ...node, sortOrder: depth } as FolderNode & { sortOrder: number })
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolders(node.children, depth + 1))
    }
  }
  return result
}

// Drag position type
type DragPosition =
  | { type: 'none' }
  | { type: 'nest'; folderId: number }
  | { type: 'sort'; targetId: number; before: boolean }
  | { type: 'instruction'; instruction: Instruction; itemId: number; targetId: number }

// Tree item registry for flash effects
type CleanupFn = () => void;

function createTreeItemRegistry() {
  const registry = new Map<string, { element: HTMLElement }>();

  const registerTreeItem = ({
    itemId,
    element,
  }: {
    itemId: string;
    element: HTMLElement;
  }): CleanupFn => {
    registry.set(itemId, { element });
    return () => {
      registry.delete(itemId);
    };
  };

  return { registry, registerTreeItem };
}

interface FolderItemProps {
  folder: FolderNode
  depth: number
  dragPosition: DragPosition
  activeId: number | null
  onDragPositionChange: (position: DragPosition) => void
  focusTree: () => void
  onSelectFolder: (folderId: number) => Promise<void>
  registerKeyboardItem: (folderId: number, element: HTMLDivElement | null) => void
  registerItem?: ({ itemId, element }: { itemId: string; element: HTMLElement }) => CleanupFn
}

function FolderItem({
  folder,
  depth,
  dragPosition,
  activeId,
  onDragPositionChange,
  focusTree,
  onSelectFolder,
  registerKeyboardItem,
  registerItem,
}: FolderItemProps) {
  const { folders, selectedFolderId, expandedFolderIds, toggleFolder, moveFolder, reorderFolders, uniqueContextId, dragOverFolderId, setDragOverFolderId } = useFolderStore()
  const { setAddingSubfolder, setEditingFolder, setDeleteConfirm } = useFolderStore()
  const isExpanded = expandedFolderIds.includes(folder.id)
  const isSelected = selectedFolderId === folder.id
  const hasChildren = folder.children && folder.children.length > 0
  const isSystemFolder = folder.name === '浏览器采集' || folder.isSystem
  const isBeingDragged = activeId === folder.id
  const isExternalDragTarget = dragOverFolderId === folder.id

  // Check if this folder can be dragged (not a system folder)
  const canDrag = !isSystemFolder

  // ref for the draggable element (the folder row itself)
  const draggableRef = useRef<HTMLDivElement>(null)

  // Register for flash effect
  useEffect(() => {
    if (!draggableRef.current || !registerItem) return
    return registerItem({ itemId: folder.id.toString(), element: draggableRef.current })
  }, [folder.id, registerItem])

  // Compute available targets for "Move to" submenu (exclude self, descendants, and system folders)
  const flatFolders = flattenFolders(folders)
  const availableTargets = flatFolders.filter(target => {
    if (target.id === folder.id) return false
    if (isDescendant(folders, folder.id, target.id)) return false
    if (target.name === '浏览器采集' || target.isSystem) return false
    return true
  })

  // Add root option at the beginning
  const menuItems = [
    { id: null, name: '根目录', sortOrder: -1 as number, children: [], fileCount: 0 },
    ...availableTargets
  ]
  const parentId = findFolderParentId(folders, folder.id, null)
  const siblingFolders = findSiblings(folders, parentId).filter(item => !item.isSystem && item.name !== '浏览器采集')
  const siblingIndex = siblingFolders.findIndex(item => item.id === folder.id)
  const canMoveUp = siblingIndex > 0
  const canMoveDown = siblingIndex >= 0 && siblingIndex < siblingFolders.length - 1

  // Setup draggable and drop target
  useEffect(() => {
    const element = draggableRef.current
    if (!element) return

    // Only make draggable if not a system folder
    if (!canDrag) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'folder',
          folderId: folder.id,
          folderName: folder.name,
          uniqueContextId,
        }),
        onDragStart: ({ source }) => {
          onDragPositionChange({ type: 'none' })
          // We use a custom event to notify parent about activeId
          const event = new CustomEvent('folder-drag-start', {
            detail: { folderId: source.data.folderId },
            bubbles: true
          })
          element.dispatchEvent(event)
        },
        onDrop: () => {
          const event = new CustomEvent('folder-drag-end', {
            detail: {},
            bubbles: true
          })
          element.dispatchEvent(event)
        }
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element }) => {
          const data = {
            type: 'folder' as const,
            folderId: folder.id,
            folderName: folder.name,
            hasChildren,
            uniqueContextId,
          }
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges: ['top', 'bottom'],
          })
        },
        canDrop: ({ source }) => {
          // Only accept drops from our own context
          if (source.data.uniqueContextId !== uniqueContextId) {
            return false
          }
          // Only folder drag/sort uses Atlaskit DnD. Files use native HTML drag/drop.
          return source.data.type === 'folder' && source.data.folderId !== folder.id
        },
        onDragEnter: ({ source }) => {
          if (source.data.type === 'folder') {
            const sourceFolderId = source.data.folderId as number
            // Check for circular reference
            if (sourceFolderId === folder.id || isDescendant(folders, sourceFolderId, folder.id)) return
            onDragPositionChange({ type: 'nest', folderId: folder.id })
          }
          // For files, we don't show a visual indicator for nesting
        },
        onDragLeave: ({ source }) => {
          // Only reset if we're leaving to a non-child target
          if (source.data.type === 'folder') {
            const sourceFolderId = source.data.folderId as number
            // Keep the nest position if moving to a child
            if (isDescendant(folders, folder.id, sourceFolderId)) return
            if (dragPosition.type === 'nest' && dragPosition.folderId === folder.id) {
              onDragPositionChange({ type: 'none' })
            }
          }
        },
        onDrop: () => {
          // Handled by monitorForElements in parent
        }
      })
    )
  }, [folder.id, canDrag, hasChildren, folders, uniqueContextId])

  const handleAddSubfolder = () => {
    setAddingSubfolder(folder)
  }

  const handleRename = () => {
    setEditingFolder(folder)
  }

  const handleDelete = () => {
    setDeleteConfirm(folder)
  }

  const handleShowInExplorer = async () => {
    try {
      await showFolderInExplorer(folder.id)
    } catch (err) {
      console.error('Failed to show folder in explorer:', err)
    }
  }

  const moveFolderByStep = async (step: -1 | 1) => {
    if (isSystemFolder) return
    const nextIndex = siblingIndex + step
    if (siblingIndex < 0 || nextIndex < 0 || nextIndex >= siblingFolders.length) return
    const reordered = [...siblingFolders]
    const [moved] = reordered.splice(siblingIndex, 1)
    reordered.splice(nextIndex, 0, moved)
    await reorderFolders(reordered.map(item => item.id))
  }

  const isInternalFileDrag = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes(INTERNAL_FILE_DRAG_MIME)) {
      return true
    }

    const { isDraggingInternal, draggedFileIds } = useSelectionStore.getState()
    return isDraggingInternal && draggedFileIds.length > 0
  }

  const isExternalFileDrag = (e: React.DragEvent) => {
    return Array.from(e.dataTransfer.types).includes('Files')
  }

  const getDraggedFileIds = (e: React.DragEvent) => {
    if (isInternalFileDrag(e)) {
      try {
        const raw = e.dataTransfer.getData(INTERNAL_FILE_DRAG_MIME)
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        }
      } catch (error) {
        console.error('Failed to parse internal drag file ids:', error)
      }
    }

    return useSelectionStore.getState().draggedFileIds
  }

  const handleExternalDragEnter = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e) && !isInternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderId(folder.id)
  }

  const handleExternalDragOver = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e) && !isInternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = isInternalFileDrag(e) ? 'move' : 'copy'
    if (dragOverFolderId !== folder.id) {
      setDragOverFolderId(folder.id)
    }
  }

  const handleExternalDragLeave = (e: React.DragEvent) => {
    if (!isExternalFileDrag(e) && !isInternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()

    const nextTarget = e.relatedTarget
    if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
      return
    }

    if (dragOverFolderId === folder.id) {
      setDragOverFolderId(null)
    }
  }

  const handleExternalDrop = async (e: React.DragEvent) => {
    if (!isExternalFileDrag(e) && !isInternalFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()

    if (isInternalFileDrag(e)) {
      const fileIds = getDraggedFileIds(e)
      console.log('[FolderTree] internal drop', {
        folderId: folder.id,
        fileIds,
        currentDragSessionId: useSelectionStore.getState().currentDragSessionId,
      })
      if (!useSelectionStore.getState().markInternalDropHandled()) {
        return
      }
      if (fileIds.length > 1) {
        await useLibraryQueryStore.getState().moveFiles(fileIds, folder.id)
      } else if (fileIds.length === 1) {
        await useLibraryQueryStore.getState().moveFile(fileIds[0], folder.id)
      }
      useSelectionStore.getState().clearInternalFileDrag()
      setDragOverFolderId(null)
      return
    }

    setDragOverFolderId(folder.id)
  }

  // Determine visual state based on dragPosition
  const isNestingTarget = dragPosition.type === 'nest' && dragPosition.folderId === folder.id && !isBeingDragged

  // For sorting, we check if this folder is the target
  const isSortTarget = dragPosition.type === 'sort' && dragPosition.targetId === folder.id && !isBeingDragged

  // Show insertion line - for "before" position, show at top; for "after" position, show at bottom
  const showInsertLineBefore = isSortTarget && dragPosition.before
  const showInsertLineAfter = isSortTarget && !dragPosition.before

  return (
    <div className="folder-item-wrapper" data-folder-id={folder.id}>
      {/* Insertion line - top (before this item) */}
      {showInsertLineBefore && canDrag && (
        <div
          className="h-0.5 bg-blue-500 rounded-full my-0.5 relative"
          style={{ marginLeft: `${depth * 12 + 8}px` }}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-500 rounded-full" />
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={(element) => {
              draggableRef.current = element
              registerKeyboardItem(folder.id, element)
            }}
            data-folder-id={folder.id}
            className={`${appTreeRowClass} ${
              isBeingDragged
                ? 'opacity-50'
                : canDrag
                  ? 'cursor-pointer'
                  : 'cursor-default'
            } ${
              isSelected
                ? 'bg-primary-100 dark:bg-primary-900/30'
                : isExternalDragTarget
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 ring-2 ring-emerald-400 dark:ring-emerald-600'
                : isNestingTarget
                  ? 'bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-400 dark:ring-blue-600'
                  : 'hover:bg-gray-100 dark:hover:bg-dark-border'
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => {
              focusTree()
              void onSelectFolder(folder.id)
            }}
            onDragEnter={handleExternalDragEnter}
            onDragOver={handleExternalDragOver}
            onDragLeave={handleExternalDragLeave}
            onDrop={handleExternalDrop}
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

            <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{folder.name}</span>

            {folder.fileCount > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{folder.fileCount}</span>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={handleShowInExplorer}>
            <FolderOpen className="w-4 h-4 mr-2" />
            显示在资源管理器
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleAddSubfolder}>
            <Plus className="w-4 h-4 mr-2" />
            创建子文件夹
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRename}>
            <Pencil className="w-4 h-4 mr-2" />
            重命名
          </ContextMenuItem>
          {!isSystemFolder && (
            <ContextMenuItem disabled={!canMoveUp} onSelect={() => moveFolderByStep(-1)}>
              上移
            </ContextMenuItem>
          )}
          {!isSystemFolder && (
            <ContextMenuItem disabled={!canMoveDown} onSelect={() => moveFolderByStep(1)}>
              下移
            </ContextMenuItem>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="w-4 h-4 mr-2" />
              移动到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {menuItems.map((target) => (
                <ContextMenuItem
                  key={target.id === null ? 'root' : target.id}
                  onSelect={() => moveFolder(folder.id, target.id)}
                  style={{ paddingLeft: `${((target.sortOrder as number) === -1 ? 0 : target.sortOrder || 0) * 12 + 8}px` }}
                >
                  {(target.sortOrder as number) === -1 ? '📁 ' + target.name : target.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDelete} className="text-red-600">
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-1">
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              dragPosition={dragPosition}
              activeId={activeId}
              onDragPositionChange={onDragPositionChange}
              focusTree={focusTree}
              onSelectFolder={onSelectFolder}
              registerKeyboardItem={registerKeyboardItem}
              registerItem={registerItem}
            />
          ))}
        </div>
      )}

      {/* Insertion line - bottom (after this item) */}
      {showInsertLineAfter && canDrag && (
        <div
          className="h-0.5 bg-blue-500 rounded-full my-0.5 relative"
          style={{ marginLeft: `${depth * 12 + 8}px` }}
        >
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-500 rounded-full" />
        </div>
      )}
    </div>
  )
}

export default function FolderTree() {
  const {
    folders,
    selectedFolderId,
    expandedFolderIds,
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
    reorderFolders,
    moveFolder,
    setFolders,
    uniqueContextId,
  } = useFolderStore()
  const loadFilesInFolder = useLibraryQueryStore((state) => state.loadFilesInFolder)
  const [isAdding, setIsAdding] = useState(false)

  // Drag state - simplified to track only what's needed
  const [activeId, setActiveId] = useState<number | null>(null)
  const [dragPosition, setDragPosition] = useState<DragPosition>({ type: 'none' })

  // Track mouse position for drag between folders
  const mouseYRef = useRef<number>(0)
  const visibleFolderItems = useMemo(
    () => [
      {
        id: null,
        parentId: null,
        depth: 0,
        hasChildren: false,
        isExpanded: false,
      },
      ...buildVisibleTreeItems(folders, {
        expandedIds: expandedFolderIds,
        getId: (folder) => folder.id,
        getChildren: (folder) => folder.children,
      }),
    ],
    [expandedFolderIds, folders],
  )
  const {
    containerRef: treeContainerRef,
    focusContainer: focusTree,
    registerItem: registerKeyboardItem,
    handleKeyDown: handleTreeKeyDown,
  } = useTreeKeyboardNavigation({
    items: visibleFolderItems,
    selectedId: selectedFolderId,
    onSelect: async (folderId) => {
      focusTree()
      await selectFolderFromTree(folderId)
    },
    onToggle: (folderId) => {
      useFolderStore.getState().toggleFolder(folderId)
    },
    onActivate: requestFocusFirstFile,
  })

  // Listen for drag events from child FolderItem components
  useEffect(() => {
    const container = document.getElementById('folder-tree-container')
    if (!container) return

    const handleDragStart = (e: Event) => {
      const customEvent = e as CustomEvent<{ folderId: number }>
      setActiveId(customEvent.detail.folderId)
    }

    const handleDragEnd = () => {
      setActiveId(null)
    }

    // Track mouse position during drag for "between folders" detection
    const handleMouseMove = (e: MouseEvent) => {
      mouseYRef.current = e.clientY
    }

    // Add mousemove listener on document to track mouse during drag
    document.addEventListener('mousemove', handleMouseMove)

    container.addEventListener('folder-drag-start', handleDragStart)
    container.addEventListener('folder-drag-end', handleDragEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('folder-drag-start', handleDragStart)
      container.removeEventListener('folder-drag-end', handleDragEnd)
    }
  }, [])

  // Monitor drag events at the document level for drop handling
  // Use useState with initializer function to only create registry once
  const [registryState] = useState(() => createTreeItemRegistry());
  const { registry, registerTreeItem } = registryState;

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) =>
        source.data.uniqueContextId === uniqueContextId &&
        source.data.type === 'folder',
      onDragStart: ({ source }) => {
        if (source.data.type === 'folder') {
          setActiveId(source.data.folderId as number)
        }
      },
      onDrag: ({ source, location }) => {
        const dropTargets = location.current.dropTargets

        if (dropTargets.length === 0) {
          // No drop target - check if we're between folders for sorting
          // Manually find the closest folder for sorting indicator
          const allIds = getAllFolderIds(folders)
          let closestFolder: { id: number; element: HTMLElement } | null = null
          let minDistance = Infinity
          const mouseY = mouseYRef.current

          for (const id of allIds) {
            const item = registry.get(id.toString())
            if (!item?.element) continue
            const rect = item.element.getBoundingClientRect()
            const folderCenterY = rect.top + rect.height / 2
            const distance = Math.abs(mouseY - folderCenterY)
            if (distance < minDistance) {
              minDistance = distance
              closestFolder = { id, element: item.element }
            }
          }

          if (closestFolder && minDistance < 100) { // Within 100px threshold
            const rect = closestFolder.element.getBoundingClientRect()
            const before = mouseY < rect.top + rect.height / 2
            setDragPosition({
              type: 'sort',
              targetId: closestFolder.id,
              before
            })
          } else {
            setDragPosition({ type: 'none' })
          }
          return
        }

        const target = dropTargets[0]
        const targetData = target.data

        // Check for closest edge first (for sorting) - only for folder drags
        const closestEdge = extractClosestEdge(targetData)
        const isFolderDrag = source.data.type === 'folder'
        const sourceFolderId = isFolderDrag ? source.data.folderId as number : null

        if (closestEdge && isFolderDrag) {
          // top/bottom edges for folder sorting
          const targetFolderId = targetData.folderId as number
          setDragPosition({
            type: 'sort',
            targetId: targetFolderId,
            before: closestEdge === 'top'
          })
          return
        }

        // No closest edge - check if dropping on a folder body (for nesting)
        if (targetData.type === 'folder') {
          const targetFolderId = targetData.folderId as number

          // For folder drags, prevent nesting on itself or circular reference
          if (isFolderDrag) {
            if (sourceFolderId !== targetFolderId && !isDescendant(folders, sourceFolderId!, targetFolderId)) {
              setDragPosition({ type: 'nest', folderId: targetFolderId })
              return
            }
          } else {
            // For file drags, always allow nesting
            setDragPosition({ type: 'nest', folderId: targetFolderId })
            return
          }
        }

        setDragPosition({ type: 'none' })
      },
      onDrop: ({ source, location }) => {
        const dropTargets = location.current.dropTargets

        // Handle folder drop using saved dragPosition if available (for drops in empty areas)
        if (source.data.type === 'folder' && dragPosition.type === 'sort') {
          const activeFolderId = source.data.folderId as number
          const targetId = dragPosition.targetId
          const insertBefore = dragPosition.before

          // Check for circular reference
          if (isDescendant(folders, activeFolderId, targetId)) {
            console.log('Cannot drag parent into its own child (circular reference)')
            setDragPosition({ type: 'none' })
            setActiveId(null)
            return
          }

          // Find the parent of both folders
          const activeParentId = findFolderParentId(folders, activeFolderId, null)
          const targetParentId = findFolderParentId(folders, targetId, null)

          // If different parents, it's a move operation
          if (activeParentId !== targetParentId) {
            // Check if target is parent of active (circular reference)
            if (isDescendant(folders, activeFolderId, targetId)) {
              console.log('Cannot drag parent to child position (circular reference)')
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Cross-parent move
            moveFolder(activeFolderId, targetParentId)

            setDragPosition({ type: 'none' })
            setActiveId(null)
            return
          } else {
            // Same parent - just reorder
            const siblings = findSiblings(folders, activeParentId)
            const activeIndex = siblings.findIndex(f => f.id === activeFolderId)
            const targetIndex = siblings.findIndex(f => f.id === targetId)

            if (activeIndex === -1 || targetIndex === -1) {
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Calculate the new index based on insert position
            let newIndex = targetIndex
            if (!insertBefore && targetIndex > activeIndex) {
              newIndex = targetIndex
            } else if (!insertBefore && targetIndex < activeIndex) {
              newIndex = targetIndex + 1
            } else if (insertBefore && targetIndex > activeIndex) {
              newIndex = targetIndex - 1
            } else if (insertBefore && targetIndex < activeIndex) {
              newIndex = targetIndex
            }

            if (newIndex === activeIndex) {
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Reorder the array
            const newSiblings = [...siblings]
            const [movedFolder] = newSiblings.splice(activeIndex, 1)
            newSiblings.splice(newIndex, 0, movedFolder)

            // Update UI optimistically
            const updateFoldersOrder = (items: FolderNode[]): FolderNode[] => {
              return items.map(item => {
                if (item.id === activeParentId) {
                  return { ...item, children: newSiblings }
                }
                if (item.children && item.children.length > 0) {
                  return { ...item, children: updateFoldersOrder(item.children) }
                }
                return item
              })
            }

            if (activeParentId === null) {
              setFolders(newSiblings)
            } else {
              setFolders(updateFoldersOrder(folders))
            }

            // Call API to persist the order
            const folderIds = newSiblings
              .filter(f => !f.isSystem && f.name !== '浏览器采集')
              .map(f => f.id)

            if (folderIds.length > 0) {
              reorderFolders(folderIds)
            }

          }

          setDragPosition({ type: 'none' })
          setActiveId(null)
          return
        }

        if (dropTargets.length === 0) {
          setDragPosition({ type: 'none' })
          setActiveId(null)
          return
        }

        const target = dropTargets[0]
        const targetData = target.data

        // Handle folder drop
        const activeFolderId = source.data.folderId as number

        // Case 1: Nesting (dropped on a folder body)
        if (targetData.type === 'folder') {
          const targetFolderId = targetData.folderId as number

          // Prevent dropping on itself or circular reference
          if (activeFolderId !== targetFolderId && !isDescendant(folders, activeFolderId, targetFolderId)) {
            moveFolder(activeFolderId, targetFolderId)

          }
        }

        // Case 2: Sorting (dropped on edge)
        const closestEdge = extractClosestEdge(targetData)
        if (closestEdge && targetData.folderId !== activeFolderId) {
          const targetId = targetData.folderId as number
          const insertBefore = closestEdge === 'top'

          // Check for circular reference
          if (isDescendant(folders, activeFolderId, targetId)) {
            console.log('Cannot drag parent into its own child (circular reference)')
            setDragPosition({ type: 'none' })
            setActiveId(null)
            return
          }

          // Find the parent of both folders
          const activeParentId = findFolderParentId(folders, activeFolderId, null)
          const targetParentId = findFolderParentId(folders, targetId, null)

          // If different parents, it's a move operation
          if (activeParentId !== targetParentId) {
            // Check if target is parent of active (circular reference)
            if (isDescendant(folders, activeFolderId, targetId)) {
              console.log('Cannot drag parent to child position (circular reference)')
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Cross-parent move
            moveFolder(activeFolderId, targetParentId)

          } else {
            // Same parent - just reorder
            const siblings = findSiblings(folders, activeParentId)
            const activeIndex = siblings.findIndex(f => f.id === activeFolderId)
            const targetIndex = siblings.findIndex(f => f.id === targetId)

            if (activeIndex === -1 || targetIndex === -1) {
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Calculate the new index based on insert position
            let newIndex = targetIndex
            if (!insertBefore && targetIndex > activeIndex) {
              newIndex = targetIndex
            } else if (!insertBefore && targetIndex < activeIndex) {
              newIndex = targetIndex + 1
            } else if (insertBefore && targetIndex > activeIndex) {
              newIndex = targetIndex - 1
            } else if (insertBefore && targetIndex < activeIndex) {
              newIndex = targetIndex
            }

            if (newIndex === activeIndex) {
              setDragPosition({ type: 'none' })
              setActiveId(null)
              return
            }

            // Reorder the array
            const newSiblings = [...siblings]
            const [movedFolder] = newSiblings.splice(activeIndex, 1)
            newSiblings.splice(newIndex, 0, movedFolder)

            // Update UI optimistically
            const updateFoldersOrder = (items: FolderNode[]): FolderNode[] => {
              return items.map(item => {
                if (item.id === activeParentId) {
                  return { ...item, children: newSiblings }
                }
                if (item.children && item.children.length > 0) {
                  return { ...item, children: updateFoldersOrder(item.children) }
                }
                return item
              })
            }

            if (activeParentId === null) {
              setFolders(newSiblings)
            } else {
              setFolders(updateFoldersOrder(folders))
            }

            // Call API to persist the order
            const folderIds = newSiblings
              .filter(f => !f.isSystem && f.name !== '浏览器采集')
              .map(f => f.id)

            if (folderIds.length > 0) {
              reorderFolders(folderIds)
            }

          }
        }

        setDragPosition({ type: 'none' })
        setActiveId(null)
      }
    })
  }, [folders, moveFolder, reorderFolders, setFolders, uniqueContextId])

  const selectFolderForKeyboard = async (folderId: number | null) => {
    focusTree()
    await selectFolderFromTree(folderId)
  }

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

      await deleteFolder(deletedId)
      await loadFolders()

      if (selectedFolderId === deletedId) {
        const { folders } = useFolderStore.getState()
        if (folders.length > 0) {
          const firstFolder = folders[0]
          selectFolder(firstFolder.id)
          await loadFilesInFolder(firstFolder.id)
        } else {
          selectFolder(null)
          await loadFilesInFolder(null)
        }
      }
    }
  }

  return (
    <div className="flex flex-col">
      <div className={appPanelHeaderClass}>
        <h2 className={appPanelTitleClass}>文件夹</h2>
        <div className="flex items-center gap-1">
          <TrashPanel variant="header" />
          <Button
            variant="ghost"
            size="icon"
            className="rounded-lg"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div
        id="folder-tree-container"
        ref={treeContainerRef}
        className="relative flex-1 overflow-auto p-2.5 focus:outline-none"
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
      >
        {isLoading && folders.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Virtual "全部文件" (All Files) item - cannot be deleted */}
            <div
              ref={(element) => registerKeyboardItem(null, element)}
              className={`${appTreeRowClass} cursor-pointer ${
                selectedFolderId === null
                  ? 'bg-primary-100 dark:bg-primary-900/30'
                  : 'hover:bg-gray-100 dark:hover:bg-dark-border'
              }`}
              style={{ paddingLeft: '8px' }}
              onClick={() => {
                focusTree()
                void selectFolderForKeyboard(null)
              }}
            >
              <span className="w-5" />
              <Files className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">全部文件</span>
            </div>

            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                depth={0}
                dragPosition={dragPosition}
                activeId={activeId}
                onDragPositionChange={setDragPosition}
                focusTree={focusTree}
                onSelectFolder={selectFolderForKeyboard}
                registerKeyboardItem={registerKeyboardItem}
                registerItem={registerTreeItem}
              />
            ))}

            {folders.length === 0 && (
              <div className="py-4 text-center text-[12px] text-gray-400 dark:text-gray-500">
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
