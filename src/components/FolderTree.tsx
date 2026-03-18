import { useState, useCallback } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  useDroppable,
  defaultDropAnimationSideEffects,
  DropAnimation,
  DragStartEvent,
  DragOverEvent,
  pointerWithin,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { ChevronRight, Folder as FolderIcon, Plus, Trash2, Pencil, Globe, Move } from 'lucide-react'

// Helper functions for folder tree operations
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

// Calculate the global index of a folder in the entire tree
const findGlobalIndex = (folders: FolderNode[], folderId: number, currentIndex: number = 0): number => {
  for (const folder of folders) {
    if (folder.id === folderId) return currentIndex
    currentIndex++
    if (folder.children && folder.children.length > 0) {
      const found = findGlobalIndex(folder.children, folderId, currentIndex)
      if (found !== -1) return found
      currentIndex += folder.children.length
    }
  }
  return -1
}

// Check if a folder is a descendant of another
const isDescendant = (folders: FolderNode[], parentId: number, childId: number): boolean => {
  const findFolder = (items: FolderNode[], id: number): FolderNode | null => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.children) {
        const found = findFolder(item.children, id)
        if (found) return found
      }
    }
    return null
  }

  const parent = findFolder(folders, parentId)
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

interface FolderItemProps {
  folder: FolderNode
  depth: number
  dragPosition: DragPosition
  activeId: number | null
  onDragPositionChange: (position: DragPosition) => void
  allFolderIds: number[]
}

function FolderItem({ folder, depth, dragPosition, activeId, onDragPositionChange, allFolderIds }: FolderItemProps) {
  const { folders, selectedFolderId, expandedFolderIds, selectFolder, toggleFolder, moveFolder } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId, setSelectedFile } = useFileStore()
  const { setAddingSubfolder, setEditingFolder, setDeleteConfirm } = useFolderStore()
  const isExpanded = expandedFolderIds.includes(folder.id)
  const isSelected = selectedFolderId === folder.id
  const hasChildren = folder.children && folder.children.length > 0
  const isSystemFolder = folder.name === '浏览器采集' || folder.isSystem

  // Check if this folder can be dragged (not a system folder)
  const canDrag = !isSystemFolder

  // Compute available targets for "Move to" submenu (exclude self, descendants, and system folders)
  const flatFolders = flattenFolders(folders)
  const availableTargets = flatFolders.filter(target => {
    if (target.id === folder.id) return false
    if (isDescendant(folders, folder.id, target.id)) return false
    if (target.name === '浏览器采集' || target.isSystem) return false
    return true
  })

  // dnd-kit sortable
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: folder.id,
    disabled: !canDrag
  })

  // dnd-kit useDroppable for detecting folder body hover (nesting)
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `folder-drop-${folder.id}`,
    data: { type: 'folder', folderId: folder.id, folderName: folder.name }
  })

  // Combine both refs into one callback
  const setRef = useCallback((node: HTMLDivElement | null) => {
    setSortableRef(node)
    setDroppableRef(node)
  }, [setSortableRef, setDroppableRef])

  // Don't apply transform if this item is being dragged - it stays in place
  const style = isDragging
    ? { transition: 'none' }
    : { transform: CSS.Transform.toString(transform), transition }

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

  // Only show as draggable when there's an active drag and this isn't the dragged item
  const isBeingDragged = activeId === folder.id

  // Determine visual state based on dragPosition
  const isNestingTarget = dragPosition.type === 'nest' && dragPosition.folderId === folder.id && !isBeingDragged

  // For sorting, we check if this folder is the target
  const isSortTarget = dragPosition.type === 'sort' && dragPosition.targetId === folder.id && !isBeingDragged

  // Show insertion line - for "before" position, show at top; for "after" position, show at bottom
  const showInsertLineBefore = isSortTarget && dragPosition.before
  const showInsertLineAfter = isSortTarget && !dragPosition.before

  return (
    <div ref={setRef} style={style}>
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
            {...attributes}
            {...listeners}
            data-folder-id={folder.id}
            className={`group flex items-center gap-1 px-2 py-1.5 rounded-md text-sm transition-colors ${
              isBeingDragged
                ? 'cursor-grabbing'
                : canDrag
                  ? 'cursor-grab active:cursor-grabbing'
                  : 'cursor-default'
            } ${
              isSelected
                ? 'bg-primary-100 dark:bg-primary-900/30'
                : isNestingTarget
                  ? 'bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-400 dark:ring-blue-600'
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
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="w-4 h-4 mr-2" />
              移动到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {availableTargets.map((target) => (
                <ContextMenuItem
                  key={target.id}
                  onClick={() => moveFolder(folder.id, target.id)}
                  style={{ paddingLeft: `${((target.sortOrder as number) || 0) * 12 + 8}px` }}
                >
                  {target.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} className="text-red-600">
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <SortableContext
          items={folder.children.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              dragPosition={dragPosition}
              activeId={activeId}
              onDragPositionChange={onDragPositionChange}
              allFolderIds={allFolderIds}
            />
          ))}
        </SortableContext>
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
  } = useFolderStore()
  const { loadFilesInFolder, setSelectedFolderId } = useFileStore()
  const [isAdding, setIsAdding] = useState(false)

  // Drag state - simplified to track only what's needed
  const [activeId, setActiveId] = useState<number | null>(null)
  const [dragPosition, setDragPosition] = useState<DragPosition>({ type: 'none' })

  // Dnd-kit sensors - prevent accidental drag with delay
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  )

  const activeFolder = activeId ? (() => {
    const findFolder = (items: FolderNode[]): FolderNode | null => {
      for (const item of items) {
        if (item.id === activeId) return item
        if (item.children) {
          const found = findFolder(item.children)
          if (found) return found
        }
      }
      return null
    }
    return findFolder(folders)
  })() : null

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0',
        },
      },
    }),
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event

    if (!over || !active) {
      setDragPosition({ type: 'none' })
      return
    }

    const activeId = active.id as number
    const overData = over.data.current

    // If dragging over a folder droppable area -> nesting
    if (overData?.type === 'folder') {
      const targetFolderId = overData.folderId as number

      // Prevent nesting on itself or circular reference
      if (activeId !== targetFolderId && !isDescendant(folders, activeId, targetFolderId)) {
        setDragPosition({ type: 'nest', folderId: targetFolderId })
        return
      }
    }

    // Dragging over a sortable item -> sorting
    // Determine if we should insert before or after based on mouse position
    const overId = over.id as number
    const activeRect = active.rect.current.translated
    const overRect = over.rect

    if (activeRect && overRect) {
      // Calculate the midpoint of the target item
      const overMiddleY = overRect.top + overRect.height / 2
      const activeCenterY = activeRect.top + activeRect.height / 2

      // If the active item is being dragged above the middle of the target, insert before
      // Otherwise, insert after
      const before = activeCenterY < overMiddleY

      setDragPosition({ type: 'sort', targetId: overId, before })
      return
    }

    setDragPosition({ type: 'none' })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveId(null)
    const finalPosition = dragPosition
    setDragPosition({ type: 'none' })

    if (!over) return

    const activeFolderId = active.id as number

    // Case 1: Nesting (dropped on a folder)
    if (finalPosition.type === 'nest') {
      const targetFolderId = finalPosition.folderId

      // Prevent dropping on itself or circular reference
      if (activeFolderId === targetFolderId) return
      if (isDescendant(folders, activeFolderId, targetFolderId)) return

      moveFolder(activeFolderId, targetFolderId)
      return
    }

    // Case 2: Sorting (dropped between items)
    if (finalPosition.type === 'sort') {
      const targetId = finalPosition.targetId
      const insertBefore = finalPosition.before

      if (activeFolderId === targetId) return

      // Find the parent of both folders
      const activeParentId = findFolderParentId(folders, activeFolderId, null)
      const targetParentId = findFolderParentId(folders, targetId, null)

      // Check for parent-child relationship - prevent circular reference
      // 1. Prevent dragging a parent into its own child (would create circular reference)
      if (isDescendant(folders, activeFolderId, targetId)) {
        console.log('Cannot drag parent into its own child (circular reference)')
        return
      }

      // 2. Prevent dragging a child before/after its own parent in the same level
      // This is allowed - child can be reordered within its siblings

      // If the target is in a different parent, this is a "move" operation
      // not just a "sort" operation - we need to change the parent
      if (activeParentId !== targetParentId) {
        // Check if this is a child-to-parent move (child being moved to parent's level)
        // or a parent-to-child move (which should be blocked)

        // If target is the parent of active folder, this is a "move out" operation
        if (targetParentId === activeFolderId) {
          // This is a parent being dragged to its child's position
          // This could create a circular reference, block it
          console.log('Cannot drag parent to child position (circular reference)')
          return
        }

        // This is a cross-parent move - move the folder to the target's parent
        // The backend will place it at the end, which is acceptable for now
        moveFolder(activeFolderId, targetParentId)
        return
      }

      // Same parent - just reorder
      const siblings = findSiblings(folders, activeParentId)
      const activeIndex = siblings.findIndex(f => f.id === activeFolderId)
      const targetIndex = siblings.findIndex(f => f.id === targetId)

      if (activeIndex === -1 || targetIndex === -1) return

      // Calculate the new index based on insert position
      let newIndex = targetIndex
      if (!insertBefore && targetIndex > activeIndex) {
        // Inserting after, and target is after current position
        newIndex = targetIndex
      } else if (!insertBefore && targetIndex < activeIndex) {
        // Inserting after, and target is before current position
        newIndex = targetIndex + 1
      } else if (insertBefore && targetIndex > activeIndex) {
        // Inserting before, and target is after current position
        newIndex = targetIndex - 1
      } else if (insertBefore && targetIndex < activeIndex) {
        // Inserting before, and target is before current position
        newIndex = targetIndex
      }

      if (newIndex === activeIndex) return

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

  // Get all folder IDs for drag calculations
  const allFolderIds = getAllFolderIds(folders)

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
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
          >
            <SortableContext items={folders.map(f => f.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {folders.map((folder) => (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    dragPosition={dragPosition}
                    activeId={activeId}
                    onDragPositionChange={setDragPosition}
                    allFolderIds={allFolderIds}
                  />
                ))}

                {folders.length === 0 && (
                  <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                    暂无文件夹
                  </div>
                )}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={dropAnimation}>
              {activeFolder && !activeFolder.isSystem && activeFolder.name !== '浏览器采集' ? (
                <div className="cursor-grabbing">
                  <div className="flex items-center gap-1 px-2 py-1.5 rounded-md text-sm bg-primary-100 dark:bg-primary-900/30 border-2 border-blue-400 dark:border-blue-600 shadow-xl">
                    <FolderIcon className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                    <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{activeFolder.name}</span>
                    {activeFolder.fileCount > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">{activeFolder.fileCount}</span>
                    )}
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
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
