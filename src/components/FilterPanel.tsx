import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { RotateCcw, Star, X } from "lucide-react"
import { Select, SelectContent, SelectItem } from "@/components/ui/Select"
import { Input } from "@/components/ui/Input"
import { useLibraryQueryStore } from "@/stores/libraryQueryStore"
import { useFilterStore } from "@/stores/filterStore"
import { useTagStore } from "@/stores/tagStore"
import { getActiveFilterCount } from "@/features/filters/schema"

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

const RATING_OPTIONS = [
  { label: "任意评分", value: "0" },
  { label: "1 星及以上", value: "1" },
  { label: "2 星及以上", value: "2" },
  { label: "3 星及以上", value: "3" },
  { label: "4 星及以上", value: "4" },
  { label: "5 星", value: "5" },
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

function getRatingDisplay(rating: number) {
  return RATING_OPTIONS.find((item) => Number(item.value) === rating)?.label ?? "评分"
}

function formatSizeBadge(criteriaMin: number | null, criteriaMax: number | null) {
  const formatMegabytes = (value: number) => `${value} MB`
  if (criteriaMin !== null && criteriaMax !== null) {
    return `${formatMegabytes(criteriaMin)} - ${formatMegabytes(criteriaMax)}`
  }
  if (criteriaMin !== null) {
    return `>= ${formatMegabytes(criteriaMin)}`
  }
  if (criteriaMax !== null) {
    return `<= ${formatMegabytes(criteriaMax)}`
  }
  return "大小"
}

function formatDateBadge(start: string | null, end: string | null) {
  if (start && end) {
    return `${start} 至 ${end}`
  }
  if (start) {
    return `${start} 起`
  }
  if (end) {
    return `${end} 前`
  }
  return "时间"
}

export default function FilterPanel() {
  const {
    criteria,
    setFileType,
    setDominantColor,
    setTagIds,
    toggleTag,
    clearFilters,
    setKeyword,
    setDateRange,
    setSizeRange,
    setMinRating,
    setFavoritesOnly,
  } = useFilterStore()
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery)
  const resetPage = useLibraryQueryStore((state) => state.resetPage)
  const flatTags = useTagStore((state) => state.flatTags)
  const didMountRef = useRef(false)

  const activeCount = getActiveFilterCount(criteria)

  const criteriaKey = useMemo(
    () =>
      JSON.stringify({
        fileType: criteria.fileType,
        tagIds: criteria.tagIds,
        dominantColor: criteria.dominantColor,
        keyword: criteria.keyword,
        dateRange: criteria.dateRange,
        sizeRange: criteria.sizeRange,
        minRating: criteria.minRating,
        favoritesOnly: criteria.favoritesOnly,
      }),
    [criteria],
  )

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }

    resetPage()
    void runCurrentQuery()
  }, [criteriaKey, resetPage, runCurrentQuery])

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
          className="w-[140px]"
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
          className="w-[110px]"
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

        <Input
          value={criteria.keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="备注 / 来源 / 关键词"
          className="h-9 w-[220px] rounded-full border-gray-200 bg-white/95 px-4 text-[13px] shadow-sm dark:border-dark-border dark:bg-dark-bg"
        />

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={criteria.dateRange.start ?? ""}
          onChange={(event) =>
            setDateRange({ ...criteria.dateRange, start: event.target.value || null })
          }
          className="h-9 w-[150px] rounded-full border-gray-200 bg-white/95 px-4 text-[13px] shadow-sm dark:border-dark-border dark:bg-dark-bg"
        />
        <Input
          type="date"
          value={criteria.dateRange.end ?? ""}
          onChange={(event) =>
            setDateRange({ ...criteria.dateRange, end: event.target.value || null })
          }
          className="h-9 w-[150px] rounded-full border-gray-200 bg-white/95 px-4 text-[13px] shadow-sm dark:border-dark-border dark:bg-dark-bg"
        />
        <Input
          type="number"
          min={0}
          value={criteria.sizeRange.min ?? ""}
          onChange={(event) =>
            setSizeRange({
              ...criteria.sizeRange,
              min: event.target.value ? Number(event.target.value) : null,
            })
          }
          placeholder="最小 MB"
          className="h-9 w-[110px] rounded-full border-gray-200 bg-white/95 px-4 text-[13px] shadow-sm dark:border-dark-border dark:bg-dark-bg"
        />
        <Input
          type="number"
          min={0}
          value={criteria.sizeRange.max ?? ""}
          onChange={(event) =>
            setSizeRange({
              ...criteria.sizeRange,
              max: event.target.value ? Number(event.target.value) : null,
            })
          }
          placeholder="最大 MB"
          className="h-9 w-[110px] rounded-full border-gray-200 bg-white/95 px-4 text-[13px] shadow-sm dark:border-dark-border dark:bg-dark-bg"
        />

        <Select
          value={String(criteria.minRating)}
          displayValue={getRatingDisplay(criteria.minRating)}
          onValueChange={(value) => setMinRating(Number(value))}
          className="w-[132px]"
          triggerClassName={TRIGGER_CLASS_NAME}
        >
          <SelectContent>
            {RATING_OPTIONS.map((rating) => (
              <SelectItem key={rating.value} value={rating.value}>
                {rating.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => setFavoritesOnly(!criteria.favoritesOnly)}
          className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] shadow-sm transition-colors ${
            criteria.favoritesOnly
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-gray-200 bg-white/95 text-gray-600 hover:border-gray-300 dark:border-dark-border dark:bg-dark-bg dark:text-gray-300"
          }`}
        >
          <Star className="h-3.5 w-3.5" />
          仅收藏
        </button>
      </div>

      {activeCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {criteria.fileType !== "all" && (
            <FilterChip onRemove={() => setFileType("all")}>
              {getFileTypeDisplay(criteria.fileType)}
            </FilterChip>
          )}

          {criteria.tagIds.length > 0 && (
            <FilterChip onRemove={() => setTagIds([])}>
              {tagDisplay}
            </FilterChip>
          )}

          {criteria.dominantColor && (
            <FilterChip onRemove={() => setDominantColor(null)}>
              <span
                className="h-2.5 w-2.5 rounded-full border border-gray-300"
                style={{ backgroundColor: criteria.dominantColor }}
              />
              {getColorDisplay(criteria.dominantColor)}
            </FilterChip>
          )}

          {criteria.keyword.trim() && (
            <FilterChip onRemove={() => setKeyword("")}>
              {criteria.keyword}
            </FilterChip>
          )}

          {(criteria.dateRange.start || criteria.dateRange.end) && (
            <FilterChip onRemove={() => setDateRange({ start: null, end: null })}>
              {formatDateBadge(criteria.dateRange.start, criteria.dateRange.end)}
            </FilterChip>
          )}

          {(criteria.sizeRange.min !== null || criteria.sizeRange.max !== null) && (
            <FilterChip onRemove={() => setSizeRange({ min: null, max: null })}>
              {formatSizeBadge(criteria.sizeRange.min, criteria.sizeRange.max)}
            </FilterChip>
          )}

          {criteria.minRating > 0 && (
            <FilterChip onRemove={() => setMinRating(0)}>
              {getRatingDisplay(criteria.minRating)}
            </FilterChip>
          )}

          {criteria.favoritesOnly && (
            <FilterChip onRemove={() => setFavoritesOnly(false)}>
              仅收藏
            </FilterChip>
          )}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  children,
  onRemove,
}: {
  children: ReactNode
  onRemove: () => void
}) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-dark-border dark:bg-dark-bg dark:text-gray-300 dark:hover:text-gray-100"
    >
      {children}
      <X className="h-3 w-3" />
    </button>
  )
}
