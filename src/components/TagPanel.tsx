import { useEffect, useMemo, useRef, useState } from "react"
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { buildVisibleTreeItems, useTreeKeyboardNavigation } from "@/hooks/useTreeKeyboardNavigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu"
import {
  appPanelHeaderClass,
  appPanelMetaClass,
  appPanelTitleClass,
  appTreeRowClass,
} from "@/lib/ui"
import { requestFocusFirstFile } from "@/lib/libraryNavigation"
import { useFilterStore } from "@/stores/filterStore"
import { useLibraryQueryStore } from "@/stores/libraryQueryStore"
import { collectTagIds, flattenTagTree, Tag, useTagStore } from "@/stores/tagStore"
import { ChevronRight, Move, Pencil, Plus, Tag as TagIcon, Tags, Trash2, X } from "lucide-react"

const TAG_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
]

type DragPosition =
  | { type: "none" }
  | { type: "sort"; targetId: number; before: boolean }

const findTagParentId = (tags: Tag[], tagId: number, parentId: number | null = null): number | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return parentId
    if (tag.children.length > 0) {
      const found = findTagParentId(tag.children, tagId, tag.id)
      if (found !== null) return found
    }
  }
  return null
}

const findTagById = (tags: Tag[], tagId: number): Tag | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return tag
    const found = findTagById(tag.children, tagId)
    if (found) return found
  }
  return null
}

const findTagSiblings = (tags: Tag[], parentId: number | null): Tag[] => {
  if (parentId === null) return tags
  const parent = findTagById(tags, parentId)
  return parent?.children ?? []
}

const isDescendant = (tags: Tag[], parentId: number, childId: number): boolean => {
  const parent = findTagById(tags, parentId)
  if (!parent) return false

  const check = (nodes: Tag[]): boolean => {
    for (const node of nodes) {
      if (node.id === childId) return true
      if (check(node.children)) return true
    }
    return false
  }

  return check(parent.children)
}

async function selectTagFromTree(tagId: number | null) {
  const tagStore = useTagStore.getState()
  const { setTagIds } = useFilterStore.getState()
  const libraryStore = useLibraryQueryStore.getState()

  if (tagId === null) {
    tagStore.setSelectedTagId(null)
    setTagIds([])
    await libraryStore.runCurrentQuery(libraryStore.selectedFolderId)
    return
  }

  tagStore.setSelectedTagId(tagId)
  const selectedTag = flattenTagTree(tagStore.tags).find((item) => item.id === tagId)
  setTagIds(selectedTag ? collectTagIds(selectedTag) : [tagId])
  await libraryStore.runCurrentQuery(libraryStore.selectedFolderId)
}

interface TagItemProps {
  tag: Tag
  depth: number
  activeId: number | null
  dragPosition: DragPosition
  expandedIds: number[]
  onToggle: (id: number) => void
  onSelect: (id: number | null) => Promise<void>
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
  onAddChild: (tag: Tag) => void
  focusPanel: () => void
  registerKeyboardItem: (tagId: number, element: HTMLDivElement | null) => void
}

function TagItem({
  tag,
  depth,
  activeId,
  dragPosition,
  expandedIds,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
  focusPanel,
  registerKeyboardItem,
}: TagItemProps) {
  const { selectedTagId } = useTagStore()
  const elementRef = useRef<HTMLDivElement>(null)
  const isExpanded = expandedIds.includes(tag.id)
  const isSelected = selectedTagId === tag.id
  const hasChildren = tag.children.length > 0
  const isDragging = activeId === tag.id
  const isSortTarget = dragPosition.type === "sort" && dragPosition.targetId === tag.id && !isDragging

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: "tag",
          tagId: tag.id,
        }),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element }) =>
          attachClosestEdge(
            {
              type: "tag" as const,
              tagId: tag.id,
            },
            {
              input,
              element,
              allowedEdges: ["top", "bottom"],
            },
          ),
        canDrop: ({ source }) => source.data.type === "tag" && source.data.tagId !== tag.id,
      }),
    )
  }, [tag.id])

  return (
    <div>
      {isSortTarget && dragPosition.before && (
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
              elementRef.current = element
              registerKeyboardItem(tag.id, element)
            }}
            className={`${appTreeRowClass} cursor-pointer ${
              isDragging
                ? "opacity-50"
                : isSelected
                  ? "bg-primary-100 dark:bg-primary-900/30"
                  : "hover:bg-gray-100 dark:hover:bg-dark-border"
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => {
              focusPanel()
              void onSelect(tag.id)
            }}
          >
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(tag.id)
                }}
              >
                <ChevronRight
                  className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              </Button>
            ) : (
              <span className="w-5" />
            )}

            <TagIcon className="w-4 h-4 flex-shrink-0" style={{ color: tag.color }} />
            <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{tag.name}</span>
            {tag.count > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{tag.count}</span>
            )}
            {isSelected && (
              <Button
                variant="ghost"
                size="icon"
                className="size-5 flex-shrink-0 rounded-md"
                onClick={(e) => {
                  e.stopPropagation()
                  focusPanel()
                  void onSelect(null)
                }}
              >
                <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
              </Button>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onAddChild(tag)}>
            <Plus className="w-4 h-4 mr-2" />
            创建子标签
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onEdit(tag)}>
            <Pencil className="w-4 h-4 mr-2" />
            重命名
          </ContextMenuItem>
          <MoveTagMenu tag={tag} />
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => onDelete(tag)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-1">
          {tag.children.map((child) => (
            <TagItem
              key={child.id}
              tag={child}
              depth={depth + 1}
              activeId={activeId}
              dragPosition={dragPosition}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              focusPanel={focusPanel}
              registerKeyboardItem={registerKeyboardItem}
            />
          ))}
        </div>
      )}

      {isSortTarget && !dragPosition.before && (
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

function MoveTagMenu({ tag }: { tag: Tag }) {
  const { tags, moveTag, reorderTags } = useTagStore()
  const flatTags = useMemo(() => flattenTagTree(tags), [tags])

  const options = flatTags.filter((item) => item.id !== tag.id && !isDescendant(tags, tag.id, item.id))

  const moveTo = async (newParentId: number | null) => {
    const currentParentId = findTagParentId(tags, tag.id)
    const oldSiblings = findTagSiblings(tags, currentParentId).filter((item) => item.id !== tag.id)
    const newSiblings = [...findTagSiblings(tags, newParentId).filter((item) => item.id !== tag.id), tag]

    await moveTag(tag.id, newParentId, newSiblings.length - 1)

    if (currentParentId !== newParentId && oldSiblings.length > 0) {
      await reorderTags(oldSiblings.map((item) => item.id), currentParentId)
    }
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Move className="w-4 h-4 mr-2" />
        移动到
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => moveTo(null)}>根标签</ContextMenuItem>
        {options.map((item) => (
          <ContextMenuItem
            key={item.id}
            onSelect={() => moveTo(item.id)}
            style={{ paddingLeft: `${item.depth * 12 + 8}px` }}
          >
            {item.name}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

export default function TagPanel() {
  const { tags, addTag, deleteTag, updateTag, reorderTags, selectedTagId, setSelectedTagId } = useTagStore()
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery)
  const selectedFolderId = useLibraryQueryStore((state) => state.selectedFolderId)
  const { setTagIds } = useFilterStore()
  const [isAdding, setIsAdding] = useState(false)
  const [addingParent, setAddingParent] = useState<Tag | null>(null)
  const [newTagName, setNewTagName] = useState("")
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0])
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("")
  const [activeId, setActiveId] = useState<number | null>(null)
  const [dragPosition, setDragPosition] = useState<DragPosition>({ type: "none" })
  const [expandedIds, setExpandedIds] = useState<number[]>([])
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)
  const handleToggle = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }
  const visibleTagItems = useMemo(
    () => [
      {
        id: null,
        parentId: null,
        depth: 0,
        hasChildren: false,
        isExpanded: false,
      },
      ...buildVisibleTreeItems(tags, {
        expandedIds,
        getId: (tag) => tag.id,
        getChildren: (tag) => tag.children,
      }),
    ],
    [expandedIds, tags],
  )
  const {
    containerRef: panelRef,
    focusContainer: focusPanel,
    registerItem: registerKeyboardItem,
    handleKeyDown: handlePanelKeyDown,
  } = useTreeKeyboardNavigation({
    items: visibleTagItems,
    selectedId: selectedTagId,
    onSelect: async (tagId) => {
      focusPanel()
      await selectTagFromTree(tagId)
    },
    onToggle: handleToggle,
    onActivate: requestFocusFirstFile,
  })

  useEffect(() => {
    setExpandedIds((prev) => {
      const validIds = new Set(flattenTagTree(tags).map((tag) => tag.id))
      const next = prev.filter((id) => validIds.has(id))
      const parents = flattenTagTree(tags).filter((tag) => tag.children.length > 0).map((tag) => tag.id)
      return Array.from(new Set([...next, ...parents]))
    })
  }, [tags])

  const selectTagForKeyboard = async (tagId: number | null) => {
    focusPanel()
    await selectTagFromTree(tagId)
  }

  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === "tag") {
          setActiveId(source.data.tagId as number)
        }
      },
      onDrag: ({ source, location }) => {
        if (source.data.type !== "tag") return
        const target = location.current.dropTargets[0]
        if (!target || target.data.type !== "tag") {
          setDragPosition({ type: "none" })
          return
        }

        const closestEdge = extractClosestEdge(target.data)
        if (!closestEdge) {
          setDragPosition({ type: "none" })
          return
        }

        setDragPosition({
          type: "sort",
          targetId: target.data.tagId as number,
          before: closestEdge === "top",
        })
      },
      onDrop: async ({ source, location }) => {
        if (source.data.type !== "tag") {
          setActiveId(null)
          setDragPosition({ type: "none" })
          return
        }

        const activeTagId = source.data.tagId as number
        const target = location.current.dropTargets[0]

        if (!target || target.data.type !== "tag") {
          setActiveId(null)
          setDragPosition({ type: "none" })
          return
        }

        const targetTagId = target.data.tagId as number
        if (activeTagId === targetTagId) {
          setActiveId(null)
          setDragPosition({ type: "none" })
          return
        }

        const before = extractClosestEdge(target.data) === "top"
        const activeParentId = findTagParentId(tags, activeTagId)
        const targetParentId = findTagParentId(tags, targetTagId)

        const targetSiblings = [...findTagSiblings(tags, targetParentId)]
        const activeIndexInTarget = targetSiblings.findIndex((item) => item.id === activeTagId)
        if (activeIndexInTarget !== -1) {
          targetSiblings.splice(activeIndexInTarget, 1)
        }

        const targetIndex = targetSiblings.findIndex((item) => item.id === targetTagId)
        const insertIndex = before ? targetIndex : targetIndex + 1
        const movedTag = findTagById(tags, activeTagId)

        if (targetIndex === -1 || !movedTag) {
          setActiveId(null)
          setDragPosition({ type: "none" })
          return
        }

        targetSiblings.splice(insertIndex, 0, movedTag)
        await reorderTags(targetSiblings.map((item) => item.id), targetParentId)

        if (activeParentId !== targetParentId) {
          const oldSiblings = findTagSiblings(tags, activeParentId).filter((item) => item.id !== activeTagId)
          if (oldSiblings.length > 0) {
            await reorderTags(oldSiblings.map((item) => item.id), activeParentId)
          }
        }

        setActiveId(null)
        setDragPosition({ type: "none" })
      },
    })
  }, [tags, reorderTags])

  const openAddDialog = (parent: Tag | null = null) => {
    setAddingParent(parent)
    setIsAdding(true)
    setNewTagName("")
    setSelectedColor(TAG_COLORS[0])
  }

  const handleAddTag = async () => {
    if (!newTagName.trim()) return
    await addTag(newTagName.trim(), selectedColor, addingParent?.id ?? null)
    if (addingParent) {
      setExpandedIds((prev) => Array.from(new Set([...prev, addingParent.id])))
    }
    setIsAdding(false)
    setAddingParent(null)
    setNewTagName("")
    setSelectedColor(TAG_COLORS[0])
  }

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  const handleSaveTag = async () => {
    if (!editingTag || !editName.trim()) return
    await updateTag(editingTag.id, editName.trim(), editColor)
    setEditingTag(null)
    setEditName("")
    setEditColor("")
  }

  const handleDeleteTag = async (tag: Tag) => {
    setDeletingTag(tag)
  }

  const confirmDeleteTag = async () => {
    if (!deletingTag) return

    if (deletingTag.id === selectedTagId) {
      setSelectedTagId(null)
      setTagIds([])
    }
    await deleteTag(deletingTag.id)
    await runCurrentQuery(selectedFolderId)
    setDeletingTag(null)
  }

  return (
    <div className="flex flex-col">
      <div className={appPanelHeaderClass}>
        <h2 className={appPanelTitleClass}>标签</h2>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg"
          onClick={() => openAddDialog()}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div
        ref={panelRef}
        className="flex-1 overflow-auto p-2.5 focus:outline-none"
        tabIndex={0}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="flex flex-col gap-1">
          <div
            ref={(element) => registerKeyboardItem(null, element)}
            className={`${appTreeRowClass} cursor-pointer ${
              selectedTagId === null
                ? "bg-primary-100 dark:bg-primary-900/30"
                : "hover:bg-gray-100 dark:hover:bg-dark-border"
            }`}
            style={{ paddingLeft: "8px" }}
            onClick={() => {
              focusPanel()
              void selectTagForKeyboard(null)
            }}
          >
            <span className="w-5" />
            <Tags className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">全部标签</span>
          </div>

          {tags.map((tag) => (
            <TagItem
              key={tag.id}
              tag={tag}
              depth={0}
              activeId={activeId}
              dragPosition={dragPosition}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={selectTagForKeyboard}
              onEdit={handleEditTag}
              onDelete={handleDeleteTag}
              onAddChild={openAddDialog}
              focusPanel={focusPanel}
              registerKeyboardItem={registerKeyboardItem}
            />
          ))}

          {tags.length === 0 && (
            <div className="py-4 text-center text-[12px] text-gray-400 dark:text-gray-500">
              暂无标签
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={isAdding}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setIsAdding(false)
            setAddingParent(null)
            setNewTagName("")
            setSelectedColor(TAG_COLORS[0])
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{addingParent ? "创建子标签" : "创建标签"}</DialogTitle>
            {addingParent && (
              <DialogDescription>
                在 "{addingParent.name}" 下创建子标签
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
              placeholder="标签名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    selectedColor === color ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAdding(false)
                setAddingParent(null)
                setNewTagName("")
                setSelectedColor(TAG_COLORS[0])
              }}
            >
              取消
            </Button>
            <Button onClick={handleAddTag}>添加</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingTag}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setEditingTag(null)
            setEditName("")
            setEditColor("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveTag()}
              placeholder="新名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setEditColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    editColor === color ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditingTag(null)
                setEditName("")
                setEditColor("")
              }}
            >
              取消
            </Button>
            <Button onClick={handleSaveTag}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deletingTag}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeletingTag(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除标签</DialogTitle>
            <DialogDescription>
              {deletingTag
                ? `删除“${deletingTag.name}”后，该标签及其子标签会从所有已关联图片中移除，且无法恢复。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeletingTag(null)}>
              取消
            </Button>
            <Button
              onClick={confirmDeleteTag}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
