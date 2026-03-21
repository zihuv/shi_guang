import { useEffect } from "react"
import { useFilterStore } from "@/stores/filterStore"
import { useFileStore } from "@/stores/fileStore"
import { useTagStore } from "@/stores/tagStore"
import { useFolderStore } from "@/stores/folderStore"
import { Select, SelectContent, SelectItem } from "@/components/ui/Select"
import { X } from "lucide-react"

const PRESET_COLORS = [
  { name: "红色", value: "#FF0000" },
  { name: "橙色", value: "#FFA500" },
  { name: "黄色", value: "#FFFF00" },
  { name: "绿色", value: "#008000" },
  { name: "青色", value: "#00FFFF" },
  { name: "蓝色", value: "#0000FF" },
  { name: "紫色", value: "#800080" },
  { name: "粉色", value: "#FFC0CB" },
  { name: "白色", value: "#FFFFFF" },
  { name: "灰色", value: "#808080" },
  { name: "黑色", value: "#000000" },
]

const FILE_TYPES = [
  { label: "全部", value: "all" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "文档", value: "document" },
]

// Helper to get color display name
const getColorDisplay = (color: string | null) => {
  if (!color) return "颜色"
  const preset = PRESET_COLORS.find(c => c.value === color)
  return preset ? preset.name : "颜色"
}

// Helper to get file type display name
const getFileTypeDisplay = (type: string) => {
  const ft = FILE_TYPES.find(t => t.value === type)
  return ft ? ft.label : "类型"
}

export default function FilterPanel() {
  const { criteria, setFileType, setDominantColor, setKeyword, setFolderId, clearFilters } = useFilterStore()
  const { filterFiles, selectedFolderId } = useFileStore()
  const { tags } = useTagStore()
  const { folders } = useFolderStore()

  // Apply filters automatically when any filter changes
  useEffect(() => {
    filterFiles({
      query: criteria.keyword || criteria.searchQuery || undefined,
      folderId: criteria.folderId ?? selectedFolderId,
      fileTypes: criteria.fileType !== 'all' ? [criteria.fileType] : undefined,
      dateStart: criteria.dateRange.start,
      dateEnd: criteria.dateRange.end,
      sizeMin: criteria.sizeRange.min,
      sizeMax: criteria.sizeRange.max,
      tagIds: criteria.tagIds.length > 0 ? criteria.tagIds : undefined,
      minRating: criteria.minRating > 0 ? criteria.minRating : undefined,
      favoritesOnly: criteria.favoritesOnly || undefined,
      dominantColor: criteria.dominantColor || undefined,
    })
  }, [
    criteria.keyword,
    criteria.fileType,
    criteria.folderId,
    criteria.tagIds,
    criteria.dominantColor,
    criteria.dateRange,
    criteria.sizeRange,
    criteria.minRating,
    criteria.favoritesOnly,
  ])

  // Flatten folder tree for dropdown
  const flattenFolders = (nodes: typeof folders, result: { id: number; name: string; path: string }[] = []): { id: number; name: string; path: string }[] => {
    for (const node of nodes) {
      result.push({ id: node.id, name: node.name, path: node.path })
      if (node.children && node.children.length > 0) {
        flattenFolders(node.children, result)
      }
    }
    return result
  }

  const flatFolders = flattenFolders(folders)

  // Get folder display name
  const getFolderDisplay = () => {
    if (criteria.folderId === null) return "文件夹"
    const folder = flatFolders.find(f => f.id === criteria.folderId)
    return folder ? folder.name : "文件夹"
  }

  // Get tag display name
  const getTagDisplay = () => {
    if (criteria.tagIds.length === 0) return "标签"
    if (criteria.tagIds.length === 1) {
      const tag = tags.find(t => t.id === criteria.tagIds[0])
      return tag ? tag.name : "标签"
    }
    return `${criteria.tagIds.length} 个标签`
  }

  const activeCount = useFilterStore.getState().getActiveFilterCount()

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-50 dark:bg-dark-bg border-b border-gray-200 dark:border-dark-border text-xs">
      {/* Color Dropdown */}
      <div className="relative">
        <Select
          value={criteria.dominantColor || "none"}
          displayValue={getColorDisplay(criteria.dominantColor)}
          onValueChange={(value) => setDominantColor(value === "none" ? null : value)}
          className="w-[80px]"
        >
          <SelectContent>
            <SelectItem value="none">全部颜色</SelectItem>
            {PRESET_COLORS.map((color) => (
              <SelectItem key={color.value} value={color.value}>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-full border border-gray-300"
                    style={{ backgroundColor: color.value }}
                  />
                  <span>{color.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {criteria.dominantColor && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setDominantColor(null)
            }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
          >
            <X className="w-2 h-2" />
          </button>
        )}
      </div>

      {/* Keyword Input */}
      <div className="relative">
        <input
          type="text"
          placeholder="关键词"
          value={criteria.keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="h-6 w-[100px] pl-2 pr-5 text-xs border border-gray-200 dark:border-dark-border rounded bg-white dark:bg-dark-bg focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {criteria.keyword && (
          <button
            onClick={() => setKeyword("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* Folder Dropdown */}
      <div className="relative">
        <Select
          value={criteria.folderId?.toString() || "none"}
          displayValue={getFolderDisplay()}
          onValueChange={(value) => setFolderId(value === "none" ? null : parseInt(value))}
          className="w-[90px]"
        >
          <SelectContent>
            <SelectItem value="none">全部</SelectItem>
            {flatFolders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id.toString()}>
                {folder.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {criteria.folderId !== null && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setFolderId(null)
            }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
          >
            <X className="w-2 h-2" />
          </button>
        )}
      </div>

      {/* Tag Dropdown */}
      <div className="relative">
        <Select
          value={criteria.tagIds.length === 1 ? criteria.tagIds[0].toString() : "none"}
          displayValue={getTagDisplay()}
          onValueChange={(value) => {
            if (value === "none") {
              criteria.tagIds.forEach(id => useFilterStore.getState().toggleTag(id))
            } else {
              const tagId = parseInt(value)
              useFilterStore.getState().toggleTag(tagId)
            }
          }}
          className="w-[70px]"
        >
          <SelectContent>
            <SelectItem value="none">全部</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id.toString()}>
                <div className="flex items-center gap-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>{tag.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {criteria.tagIds.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              criteria.tagIds.forEach(id => useFilterStore.getState().toggleTag(id))
            }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
          >
            <X className="w-2 h-2" />
          </button>
        )}
      </div>

      {/* Type Dropdown */}
      <div className="relative">
        <Select
          value={criteria.fileType}
          displayValue={getFileTypeDisplay(criteria.fileType)}
          onValueChange={(value) => setFileType(value as 'all' | 'image' | 'video' | 'document')}
          className="w-[60px]"
        >
          <SelectContent>
            {FILE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {criteria.fileType !== 'all' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setFileType('all')
            }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-gray-600 text-white rounded-full flex items-center justify-center"
          >
            <X className="w-2 h-2" />
          </button>
        )}
      </div>

      {/* Clear All Button - only show when filters are active */}
      {activeCount > 0 && (
        <button
          onClick={clearFilters}
          className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="清除所有筛选"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
