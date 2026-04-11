import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronDown, RotateCcw, SlidersHorizontal, Star, X } from "lucide-react"
import { Select, SelectContent, SelectItem } from "@/components/ui/Select"
import { Input } from "@/components/ui/Input"
import { useLibraryQueryStore } from "@/stores/libraryQueryStore"
import { useFilterStore } from "@/stores/filterStore"
import { useTagStore } from "@/stores/tagStore"
import { getActiveFilterCount } from "@/features/filters/schema"
import { cn } from "@/lib/utils"

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
  "h-8 rounded-full border-gray-200 bg-white px-3 text-[12px] text-gray-700 shadow-none hover:border-gray-300 dark:border-dark-border dark:bg-dark-bg/90 dark:text-gray-200"

const INPUT_CLASS_NAME =
  "h-8 rounded-full border-gray-200 bg-white px-3 text-[12px] shadow-none dark:border-dark-border dark:bg-dark-bg/90"

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
  const hasAdvancedFilters = Boolean(
    criteria.keyword.trim() ||
      criteria.dateRange.start ||
      criteria.dateRange.end ||
      criteria.sizeRange.min !== null ||
      criteria.sizeRange.max !== null,
  )
  const advancedFilterCount = [
    Boolean(criteria.keyword.trim()),
    Boolean(criteria.dateRange.start || criteria.dateRange.end),
    criteria.sizeRange.min !== null || criteria.sizeRange.max !== null,
  ].filter(Boolean).length
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedFilters)

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

  useEffect(() => {
    if (hasAdvancedFilters) {
      setShowAdvanced(true)
    }
  }, [hasAdvancedFilters])

  const tagDisplay =
    criteria.tagIds.length === 0
      ? "全部标签"
      : criteria.tagIds.length === 1
        ? flatTags.find((tag) => tag.id === criteria.tagIds[0])?.name ?? "标签"
        : `${criteria.tagIds.length} 个标签`

  return (
    <div className="flex w-full flex-col gap-3 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {activeCount > 0 ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">
              已筛选
            </span>

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
        ) : (
          <p className="text-[12px] text-gray-400 dark:text-gray-500">
            按类型、标签、颜色快速缩小范围。
          </p>
        )}

        <button
          type="button"
          onClick={clearFilters}
          disabled={activeCount === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-[12px] font-medium text-gray-500 transition-colors hover:border-gray-200 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-default disabled:opacity-40 dark:hover:border-dark-border dark:hover:bg-dark-border dark:hover:text-gray-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          清空
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterInlineGroup label="类型">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-gray-200 bg-gray-50/85 p-1 dark:border-dark-border dark:bg-dark-bg/85">
            {FILE_TYPES.map((type) => (
              <SegmentButton
                key={type.value}
                active={criteria.fileType === type.value}
                onClick={() => setFileType(type.value as "all" | "image" | "video" | "document")}
              >
                {type.value === "all" ? "全部" : type.label}
              </SegmentButton>
            ))}
          </div>
        </FilterInlineGroup>

        <FilterInlineGroup label="标签">
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
            className="w-[152px] max-w-full"
            triggerClassName={TRIGGER_CLASS_NAME}
          >
            <SelectContent>
              <SelectItem value="all">全部标签</SelectItem>
              {flatTags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id.toString()}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span>{"　".repeat(tag.depth)}{tag.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterInlineGroup>

        <FilterInlineGroup label="评分">
          <Select
            value={String(criteria.minRating)}
            displayValue={getRatingDisplay(criteria.minRating)}
            onValueChange={(value) => setMinRating(Number(value))}
            className="w-[128px] max-w-full"
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
        </FilterInlineGroup>

        <FilterInlineGroup label="收藏">
          <button
            type="button"
            onClick={() => setFavoritesOnly(!criteria.favoritesOnly)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
              criteria.favoritesOnly
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-dark-border dark:bg-dark-bg/90 dark:text-gray-300",
            )}
          >
            <Star className="h-3.5 w-3.5" />
            仅收藏
          </button>
        </FilterInlineGroup>

        <button
          type="button"
          onClick={() => setShowAdvanced((current) => !current)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
            showAdvanced || hasAdvancedFilters
              ? "border-gray-200 bg-gray-100 text-gray-800 dark:border-gray-600 dark:bg-dark-border dark:text-gray-100"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-dark-border dark:bg-dark-bg/90 dark:text-gray-300",
          )}
          aria-expanded={showAdvanced}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>更多筛选</span>
          {advancedFilterCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-none text-gray-700 dark:bg-black/20 dark:text-gray-100">
              {advancedFilterCount}
            </span>
          )}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")}
          />
        </button>
      </div>

      <FilterInlineGroup label="颜色" className="items-start">
        <div className="flex flex-wrap items-center gap-1.5">
          <ColorButton
            active={criteria.dominantColor === null}
            label="全部颜色"
            onClick={() => setDominantColor(null)}
          >
            全部
          </ColorButton>
          {PRESET_COLORS.map((color) => (
            <ColorButton
              key={color.value}
              active={criteria.dominantColor === color.value}
              color={color.value}
              label={color.name}
              onClick={() => setDominantColor(color.value)}
            />
          ))}
        </div>
      </FilterInlineGroup>

      {showAdvanced && (
        <div className="grid gap-3 rounded-2xl border border-gray-200/80 bg-gray-50/80 p-3 dark:border-dark-border dark:bg-dark-bg/70 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <section>
            <FilterSectionLabel>备注 / 来源</FilterSectionLabel>
            <Input
              value={criteria.keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="关键词"
              className={INPUT_CLASS_NAME}
            />
          </section>

          <section>
            <FilterSectionLabel>导入时间</FilterSectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={criteria.dateRange.start ?? ""}
                onChange={(event) =>
                  setDateRange({ ...criteria.dateRange, start: event.target.value || null })
                }
                className={INPUT_CLASS_NAME}
              />
              <Input
                type="date"
                value={criteria.dateRange.end ?? ""}
                onChange={(event) =>
                  setDateRange({ ...criteria.dateRange, end: event.target.value || null })
                }
                className={INPUT_CLASS_NAME}
              />
            </div>
          </section>

          <section>
            <FilterSectionLabel>文件大小 / MB</FilterSectionLabel>
            <div className="grid grid-cols-2 gap-2">
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
                placeholder="最小"
                className={INPUT_CLASS_NAME}
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
                placeholder="最大"
                className={INPUT_CLASS_NAME}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function FilterInlineGroup({
  children,
  className,
  label,
}: {
  children: ReactNode
  className?: string
  label: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-gray-400">
      {children}
    </div>
  )
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-full px-2.5 text-[11px] font-medium transition-colors",
        active
          ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
          : "text-gray-500 hover:bg-white/80 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-dark-surface dark:hover:text-gray-200",
      )}
    >
      {children}
    </button>
  )
}

function ColorButton({
  active,
  children,
  color,
  label,
  onClick,
}: {
  active: boolean
  children?: ReactNode
  color?: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-center rounded-full border transition-all",
        active
          ? "border-primary-300 ring-1 ring-primary-300 dark:border-primary-700 dark:ring-primary-700"
          : "border-gray-200 hover:border-gray-300 dark:border-dark-border",
        color
          ? "h-7 w-7 bg-transparent p-1"
          : "h-7 px-2.5 text-[11px] font-medium text-gray-600 dark:bg-dark-bg/90 dark:text-gray-300",
      )}
    >
      {color ? (
        <span
          className="h-full w-full rounded-full border border-black/10"
          style={{ backgroundColor: color }}
        />
      ) : (
        children
      )}
    </button>
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
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800 dark:border-dark-border dark:bg-dark-bg/90 dark:text-gray-300 dark:hover:text-gray-100"
    >
      {children}
      <X className="h-3 w-3" />
    </button>
  )
}
