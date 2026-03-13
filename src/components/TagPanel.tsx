import { useState } from 'react'
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
import { Plus, X, Pencil, Trash2 } from 'lucide-react'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899'
]

export default function TagPanel() {
  const { tags, addTag, deleteTag, updateTag, selectedTagId, setSelectedTagId } = useTagStore()
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0])

  // Edit tag dialog state
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const handleAddTag = async () => {
    if (newTagName.trim()) {
      await addTag(newTagName.trim(), selectedColor)
      setNewTagName('')
      setIsAdding(false)
      setSelectedColor(TAG_COLORS[0])
    }
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
          {tags.map((tag) => (
            <ContextMenu key={tag.id}>
              <ContextMenuTrigger>
                <div
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors h-8 ${
                    selectedTagId === tag.id
                      ? 'bg-primary-100 dark:bg-primary-900/30'
                      : 'hover:bg-gray-100 dark:hover:bg-dark-border'
                  }`}
                  onClick={() => setSelectedTagId(tag.id)}
                >
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
                        setSelectedTagId(null)
                      }}
                    >
                      <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                    </Button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => {
                    setEditingTag(tag)
                    setEditName(tag.name)
                    setEditColor(tag.color)
                  }}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  重命名
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => deleteTag(tag.id)}
                  className="text-red-600 dark:text-red-400"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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
              onKeyDown={(e) => e.key === 'Enter' && editingTag && updateTag(editingTag.id, editName, editColor)}
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
            <Button onClick={() => {
              if (editingTag && editName.trim()) {
                updateTag(editingTag.id, editName.trim(), editColor)
                setEditingTag(null)
                setEditName('')
                setEditColor('')
              }
            }}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
