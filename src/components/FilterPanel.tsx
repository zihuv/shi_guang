import { useEffect, useRef } from "react"
import { RotateCcw, X } from "lucide-react"
import { Select, SelectContent, SelectItem } from "@/components/ui/Select"
import { useFileStore } from "@/stores/fileStore"
import { useFilterStore } from "@/stores/filterStore"
import { useTagStore } from "@/stores/tagStore"

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
  { label: "全部类型", value: "all" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "文档", value: "document" },
]

const TRIGGER_CLASS_NAME =
  "h-9 rounded-full border-gray-200 bg-white/95 px-3 text-[13px] text-gray-700 shadow-sm hover:border-gray-300 dark:border-dark-border dark:bg-dark-bg dark:text-gray-200"

function getColorDisplay(color: string | null) {
  if (!color) return "颜色"
  return PRESET_COLORS.find((item) => item.value === color)?.name ?? "颜色"
}

function getFileTypeDisplay(type: string) {
  return FILE_TYPES.find((item) => item.value === type)?.label ?? "全部类型"
}

export default function FilterPanel() {
  const { criteria, setFileType, setDominantColor, setTagIds, toggleTag, clearFilters } = useFilterStore()
  const runCurrentQuery = useFileStore((state) => state.runCurrentQuery)
  const flatTags = useTagStore((state) => state.flatTags)
  const didMountRef = useRef(false)
  const tagKey = criteria.tagIds.join(",")

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }

    useFileStore.setState((state) => ({
      pagination: {
        ...state.pagination,
        page: 1,
      },
    }))
    void runCurrentQuery()
  }, [criteria.fileType, criteria.dominantColor, tagKey, runCurrentQuery])

  const activeCount =
    (criteria.fileType !== "all" ? 1 : 0) +
    (criteria.tagIds.length > 0 ? 1 : 0) +
    (criteria.dominantColor ? 1 : 0)

  const tagDisplay =
    criteria.tagIds.length === 0
      ? "标签"
      : criteria.tagIds.length === 1
        ? flatTags.find((tag) => tag.id === criteria.tagIds[0])?.name ?? "标签"
        : `${criteria.tagIds.length} 个标签`

  return (
    <div className="border-b border-gray-200/80 bg-stone-50/70 px-4 py-3 dark:border-dark-border dark:bg-dark-surface/70">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
          筛选
        </span>

        <Select
          value={criteria.fileType}
          displayValue={getFileTypeDisplay(criteria.fileType)}
          onValueChange={(value) => setFileType(value as "all" | "image" | "video" | "document")}
          className="w-[118px]"
          triggerClassName={TRIGGER_CLASS_NAME}
        >
          <SelectContent>
            {FILE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={criteria.tagIds.length === 1 ? criteria.tagIds[0].toString() : "all"}
          displayValue={tagDisplay}
          onValueChange={(value) => {
            if (value === "all") {
              setTagIds([])
              return
            }
            toggleTag(Number(value))
          }}
          className="w-[122px]"
          triggerClassName={TRIGGER_CLASS_NAME}
        >
          <SelectContent>
            <SelectItem value="all">全部标签</SelectItem>
            {flatTags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id.toString()}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>{"　".repeat(tag.depth)}{tag.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={criteria.dominantColor || "none"}
          displayValue={getColorDisplay(criteria.dominantColor)}
          onValueChange={(value) => setDominantColor(value === "none" ? null : value)}
          className="w-[108px]"
          triggerClassName={TRIGGER_CLASS_NAME}
        >
          <SelectContent>
            <SelectItem value="none">全部颜色</SelectItem>
            {PRESET_COLORS.map((color) => (
              <SelectItem key={color.value} value={color.value}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-full border border-gray-300"
                    style={{ backgroundColor: color.value }}
                  />
                  <span>{color.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeCount > 0 && (
          <button
            onClick={clearFilters}
            className="ml-auto inline-flex h-9 items-center gap-1 rounded-full border border-transparent px-3 text-[13px] text-gray-500 transition-colors hover:border-gray-200 hover:bg-white hover:text-gray-700 dark:hover:border-dark-border dark:hover:bg-dark-bg dark:hover:text-gray-200"
            title="重置筛选"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置
          </button>
        )}
      </div>

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {criteria.fileType !== "all" && (
            <button
              onClick={() => setFileType("all")}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-dark-border dark:bg-dark-bg dark:text-gray-300 dark:hover:text-gray-100"
            >
              {getFileTypeDisplay(criteria.fileType)}
              <X className="h-3 w-3" />
            </button>
          )}

          {criteria.tagIds.length > 0 && (
            <button
              onClick={() => setTagIds([])}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-dark-border dark:bg-dark-bg dark:text-gray-300 dark:hover:text-gray-100"
            >
              {tagDisplay}
              <X className="h-3 w-3" />
            </button>
          )}

          {criteria.dominantColor && (
            <button
              onClick={() => setDominantColor(null)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-dark-border dark:bg-dark-bg dark:text-gray-300 dark:hover:text-gray-100"
            >
              <span
                className="h-2.5 w-2.5 rounded-full border border-gray-300"
                style={{ backgroundColor: criteria.dominantColor }}
              />
              {getColorDisplay(criteria.dominantColor)}
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
