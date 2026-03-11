import { useState } from 'react'
import { useTagStore } from '../stores/tagStore'

const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899'
]

export default function TagPanel() {
  const { tags, addTag, deleteTag, selectedTagId, setSelectedTagId } = useTagStore()
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0])

  const handleAddTag = async () => {
    if (newTagName.trim()) {
      await addTag(newTagName.trim(), selectedColor)
      setNewTagName('')
      setIsAdding(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-dark-border">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">标签</h2>
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
        <div className="space-y-1">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
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
              <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{tag.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteTag(tag.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {isAdding && (
        <div className="p-3 border-t border-gray-200 dark:border-dark-border">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            placeholder="标签名称"
            className="w-full px-2 py-1.5 mb-2 text-sm bg-gray-100 dark:bg-dark-bg border border-transparent rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <div className="flex flex-wrap gap-1 mb-2">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`w-5 h-5 rounded-full transition-transform ${
                  selectedColor === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddTag}
              className="flex-1 px-2 py-1.5 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              添加
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
    </div>
  )
}
