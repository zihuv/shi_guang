import { useState, useRef, useEffect } from 'react'
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useTagStore, Tag } from '@/stores/tagStore'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/ContextMenu'
import { Plus, X, Pencil, Trash2, GripVertical } from 'lucide-react'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899'
]

interface SortableTagProps {
  tag: Tag
  selectedTagId: number | null
  onSelect: (id: number) => void
  onClear: (id: number) => void
  onEdit: (tag: Tag) => void
  onDelete: (id: number) => void
  isOverId: number | null
  onDragStart: () => void
  onDragEnd: () => void
}

function SortableTag({ tag, selectedTagId, onSelect, onClear, onEdit, onDelete, isOverId, onDragStart, onDragEnd }: SortableTagProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // @atlaskit draggable
  useEffect(() => {
    const element = ref.current
    if (!element) return

    return draggable({
      element,
      getInitialData: () => ({
        type: 'tag',
        tagId: tag.id,
      }),
      onDragStart: () => {
        setIsDragging(true)
        onDragStart()
      },
      onDrop: () => {
        setIsDragging(false)
        onDragEnd()
      },
    })
  }, [tag.id, onDragStart, onDragEnd])

  // Show insertion line when another item is being dragged over this item
  const showInsertLine = isOverId !== null && isOverId !== tag.id

  return (
    <div ref={ref} data-tag-id={tag.id}>
      {/* Insertion line - top */}
      {showInsertLine && (
        <div className="h-0.5 bg-primary-500 rounded-full my-0.5" />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-grab active:cursor-grabbing transition-colors h-8 ${
              selectedTagId === tag.id
                ? 'bg-primary-100 dark:bg-primary-900/30'
                : isDragging
                  ? 'opacity-50 bg-gray-100 dark:bg-dark-border'
                  : 'hover:bg-gray-100 dark:hover:bg-dark-border'
            }`}
            onClick={() => onSelect(tag.id)}
          >
            <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: tag.color }}
            />
            <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-300 truncate">{tag.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{tag.count}</span>
            {selectedTagId === tag.id && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear(tag.id)
                }}
              >
                <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
              </Button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() => onEdit(tag)}
          >
            <Pencil className="w-4 h-4 mr-2" />
            重命名
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => onDelete(tag.id)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* Insertion line - bottom (show when this is the last item before insertion point) */}
      {showInsertLine && (
        <div className="h-0.5 bg-primary-500 rounded-full my-0.5" />
      )}
    </div>
  )
}

export default function TagPanel() {
  const { tags, addTag, deleteTag, updateTag, reorderTags, selectedTagId, setSelectedTagId } = useTagStore()
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0])

  // Edit tag dialog state
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  // Drag state - activeId is only set, not read (used for tracking drag source)
  const [, setActiveId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [localTags, setLocalTags] = useState(tags)

  // Keep localTags in sync with tags prop
  useEffect(() => {
    setLocalTags(tags)
  }, [tags])

  // Monitor drag events for tag reordering
  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === 'tag') {
          setActiveId(source.data.tagId as number)
        }
      },
      onDrag: ({ source, location }) => {
        if (source.data.type !== 'tag') return

        const dropTargets = location.current.dropTargets
        if (dropTargets.length === 0) {
          setOverId(null)
          return
        }

        const target = dropTargets[0]
        if (target.data.type === 'tag') {
          setOverId(target.data.tagId as number)
        }
      },
      onDrop: ({ source, location }) => {
        if (source.data.type !== 'tag') return

        const sourceTagId = source.data.tagId as number
        const dropTargets = location.current.dropTargets

        if (dropTargets.length === 0) {
          setActiveId(null)
          setOverId(null)
          return
        }

        const target = dropTargets[0]
        if (target.data.type === 'tag') {
          const targetTagId = target.data.tagId as number

          if (sourceTagId !== targetTagId) {
            const oldIndex = localTags.findIndex(t => t.id === sourceTagId)
            const newIndex = localTags.findIndex(t => t.id === targetTagId)

            if (oldIndex !== -1 && newIndex !== -1) {
              // Optimistic update: update local state first
              const newTags = [...localTags]
              const [movedTag] = newTags.splice(oldIndex, 1)
              newTags.splice(newIndex, 0, movedTag)
              setLocalTags(newTags)

              // Then call API
              const tagIds = newTags.map(t => t.id)
              reorderTags(tagIds)
            }
          }
        }

        setActiveId(null)
        setOverId(null)
      }
    })
  }, [localTags, reorderTags])

  const handleAddTag = async () => {
    if (newTagName.trim()) {
      await addTag(newTagName.trim(), selectedColor)
      setNewTagName('')
      setIsAdding(false)
      setSelectedColor(TAG_COLORS[0])
    }
  }

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag)
    setEditName(tag.name)
    setEditColor(tag.color)
  }

  const handleSaveTag = () => {
    if (editingTag && editName.trim()) {
      updateTag(editingTag.id, editName.trim(), editColor)
      setEditingTag(null)
      setEditName('')
      setEditColor('')
    }
  }

  const handleClearTag = (_id: number) => {
    setSelectedTagId(null)
  }

  const handleDeleteTag = (id: number) => {
    deleteTag(id)
  }

  return (
    <div className="flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">标签</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {localTags.map((tag) => (
            <SortableTag
              key={tag.id}
              tag={tag}
              selectedTagId={selectedTagId}
              onSelect={setSelectedTagId}
              onClear={handleClearTag}
              onEdit={handleEditTag}
              onDelete={handleDeleteTag}
              isOverId={overId}
              onDragStart={() => {}}
              onDragEnd={() => {}}
            />
          ))}
        </div>
      </div>

      {/* Add Tag Dialog */}
      <Dialog open={isAdding} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setIsAdding(false)
          setNewTagName('')
          setSelectedColor(TAG_COLORS[0])
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="标签名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    selectedColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setIsAdding(false)
              setNewTagName('')
              setSelectedColor(TAG_COLORS[0])
            }}>
              取消
            </Button>
            <Button onClick={handleAddTag}>添加</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Tag Dialog */}
      <Dialog open={!!editingTag} onOpenChange={(isOpen) => {
        if (!isOpen) {
          setEditingTag(null)
          setEditName('')
          setEditColor('')
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTag()}
              placeholder="标签名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setEditColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${
                    editColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setEditingTag(null)
              setEditName('')
              setEditColor('')
            }}>
              取消
            </Button>
            <Button onClick={handleSaveTag}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
