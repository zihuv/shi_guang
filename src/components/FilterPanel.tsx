import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  CalendarRange,
  ChevronDown,
  FileCode2,
  Palette,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem } from "@/components/ui/Select";
import { Input as BaseInput } from "@/components/ui/Input";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useFilterStore } from "@/stores/filterStore";
import { useTagStore } from "@/stores/tagStore";
import { getActiveFilterCount } from "@/features/filters/schema";
import { cn } from "@/lib/utils";

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
];

const FILE_TYPES = [
  { label: "全部类型", value: "all" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "文档", value: "document" },
];

const RATING_OPTIONS = [
  { label: "任意评分", value: "0" },
  { label: "1 星及以上", value: "1" },
  { label: "2 星及以上", value: "2" },
  { label: "3 星及以上", value: "3" },
  { label: "4 星及以上", value: "4" },
  { label: "5 星", value: "5" },
];

const SELECT_TRIGGER_CLASS_NAME =
  "!h-auto !min-h-0 !rounded-none !border-transparent !bg-transparent !px-0 !py-0 !text-[13px] !font-medium !text-gray-600 !shadow-none hover:!border-transparent hover:!bg-transparent dark:!text-gray-300";

const INLINE_INPUT_CLASS_NAME =
  "h-8 rounded-full border-transparent bg-transparent px-0 text-[12px] text-gray-700 shadow-none placeholder:text-gray-400 focus:border-transparent focus:bg-transparent focus:ring-0 dark:text-gray-200";

function getColorDisplay(color: string | null) {
  if (!color) return "颜色";
  return PRESET_COLORS.find((item) => item.value === color)?.name ?? "颜色";
}

function getFileTypeDisplay(type: string) {
  return FILE_TYPES.find((item) => item.value === type)?.label ?? "全部类型";
}

function getRatingDisplay(rating: number) {
  return RATING_OPTIONS.find((item) => Number(item.value) === rating)?.label ?? "评分";
}

function formatSizeBadge(criteriaMin: number | null, criteriaMax: number | null) {
  const formatMegabytes = (value: number) => `${value} MB`;
  if (criteriaMin !== null && criteriaMax !== null) {
    return `${formatMegabytes(criteriaMin)} - ${formatMegabytes(criteriaMax)}`;
  }
  if (criteriaMin !== null) {
    return `>= ${formatMegabytes(criteriaMin)}`;
  }
  if (criteriaMax !== null) {
    return `<= ${formatMegabytes(criteriaMax)}`;
  }
  return "大小";
}

function formatDateBadge(start: string | null, end: string | null) {
  if (start && end) {
    return `${start} 至 ${end}`;
  }
  if (start) {
    return `${start} 起`;
  }
  if (end) {
    return `${end} 前`;
  }
  return "时间";
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
  } = useFilterStore();
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery);
  const resetPage = useLibraryQueryStore((state) => state.resetPage);
  const flatTags = useTagStore((state) => state.flatTags);
  const didMountRef = useRef(false);

  const activeCount = getActiveFilterCount(criteria);
  const hasAdvancedFilters = Boolean(
    criteria.keyword.trim() ||
    criteria.dateRange.start ||
    criteria.dateRange.end ||
    criteria.sizeRange.min !== null ||
    criteria.sizeRange.max !== null,
  );
  const advancedFilterCount = [
    Boolean(criteria.keyword.trim()),
    Boolean(criteria.dateRange.start || criteria.dateRange.end),
    criteria.sizeRange.min !== null || criteria.sizeRange.max !== null,
  ].filter(Boolean).length;
  const [showAdvanced, setShowAdvanced] = useState(hasAdvancedFilters);
  const [showColorTray, setShowColorTray] = useState(Boolean(criteria.dominantColor));

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
      }),
    [criteria],
  );

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    resetPage();
    void runCurrentQuery();
  }, [criteriaKey, resetPage, runCurrentQuery]);

  useEffect(() => {
    if (hasAdvancedFilters) {
      setShowAdvanced(true);
    }
  }, [hasAdvancedFilters]);

  useEffect(() => {
    if (criteria.dominantColor) {
      setShowColorTray(true);
    }
  }, [criteria.dominantColor]);

  const tagDisplay =
    criteria.tagIds.length === 0
      ? "全部标签"
      : criteria.tagIds.length === 1
        ? (flatTags.find((tag) => tag.id === criteria.tagIds[0])?.name ?? "标签")
        : `${criteria.tagIds.length} 个标签`;

  return (
    <div className="flex w-full flex-col gap-3 pb-1 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
          <ToolbarButton
            icon={Palette}
            label="颜色"
            active={showColorTray || Boolean(criteria.dominantColor)}
            trailing={
              criteria.dominantColor ? (
                <span
                  className="h-2.5 w-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: criteria.dominantColor }}
                />
              ) : null
            }
            onClick={() => setShowColorTray((current) => !current)}
          />

          <ToolbarSelectField icon={Bookmark} label="标签" active={criteria.tagIds.length > 0}>
            <Select
              value={criteria.tagIds.length === 1 ? criteria.tagIds[0].toString() : "all"}
              displayValue={criteria.tagIds.length > 0 ? tagDisplay : "全部"}
              onValueChange={(value) => {
                if (value === "all") {
                  setTagIds([]);
                  return;
                }
                toggleTag(Number(value));
              }}
              className="min-w-[72px] max-w-[180px]"
              triggerClassName={SELECT_TRIGGER_CLASS_NAME}
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
                      <span>
                        {"　".repeat(tag.depth)}
                        {tag.name}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarSelectField>

          <ToolbarSelectField icon={FileCode2} label="格式" active={criteria.fileType !== "all"}>
            <Select
              value={criteria.fileType}
              displayValue={
                criteria.fileType !== "all" ? getFileTypeDisplay(criteria.fileType) : "全部"
              }
              onValueChange={(value) =>
                setFileType(value as "all" | "image" | "video" | "document")
              }
              className="min-w-[56px]"
              triggerClassName={SELECT_TRIGGER_CLASS_NAME}
            >
              <SelectContent>
                {FILE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarSelectField>

          <ToolbarSelectField icon={Star} label="评分" active={criteria.minRating > 0}>
            <Select
              value={String(criteria.minRating)}
              displayValue={criteria.minRating > 0 ? getRatingDisplay(criteria.minRating) : "全部"}
              onValueChange={(value) => setMinRating(Number(value))}
              className="min-w-[56px]"
              triggerClassName={SELECT_TRIGGER_CLASS_NAME}
            >
              <SelectContent>
                {RATING_OPTIONS.map((rating) => (
                  <SelectItem key={rating.value} value={rating.value}>
                    {rating.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolbarSelectField>

          <ToolbarButton
            icon={SlidersHorizontal}
            label="更多"
            active={showAdvanced || hasAdvancedFilters}
            valueLabel={advancedFilterCount > 0 ? `${advancedFilterCount}` : null}
            trailing={
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")}
              />
            }
            onClick={() => setShowAdvanced((current) => !current)}
            ariaExpanded={showAdvanced}
          />
        </div>

        <button
          type="button"
          onClick={clearFilters}
          disabled={activeCount === 0}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-100/80 hover:text-gray-800 disabled:cursor-default disabled:opacity-35 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          清空
        </button>
      </div>

      {showColorTray && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
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
      )}

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2 pl-1">
          <InlineField icon={Search} label="关键词">
            <Input
              value={criteria.keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="备注 / 来源"
              className="min-w-[160px] sm:min-w-[180px]"
            />
          </InlineField>

          <InlineField icon={CalendarRange} label="时间">
            <Input
              type="date"
              value={criteria.dateRange.start ?? ""}
              onChange={(event) =>
                setDateRange({ ...criteria.dateRange, start: event.target.value || null })
              }
              className="min-w-[132px]"
            />
            <span className="text-[12px] text-gray-400">至</span>
            <Input
              type="date"
              value={criteria.dateRange.end ?? ""}
              onChange={(event) =>
                setDateRange({ ...criteria.dateRange, end: event.target.value || null })
              }
              className="min-w-[132px]"
            />
          </InlineField>

          <InlineField icon={FileCode2} label="大小">
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
              className="w-[88px]"
            />
            <span className="text-[12px] text-gray-400">-</span>
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
              className="w-[88px]"
            />
          </InlineField>
        </div>
      )}

      {activeCount > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[12px] text-gray-500 dark:text-gray-400">
          <span className="text-gray-400 dark:text-gray-500">已选</span>

          {criteria.fileType !== "all" && (
            <FilterChip onRemove={() => setFileType("all")}>
              {getFileTypeDisplay(criteria.fileType)}
            </FilterChip>
          )}

          {criteria.tagIds.length > 0 && (
            <FilterChip onRemove={() => setTagIds([])}>{tagDisplay}</FilterChip>
          )}

          {criteria.dominantColor && (
            <FilterChip onRemove={() => setDominantColor(null)}>
              <span
                className="h-2.5 w-2.5 rounded-full border border-black/10"
                style={{ backgroundColor: criteria.dominantColor }}
              />
              {getColorDisplay(criteria.dominantColor)}
            </FilterChip>
          )}

          {criteria.keyword.trim() && (
            <FilterChip onRemove={() => setKeyword("")}>{criteria.keyword}</FilterChip>
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
        </div>
      ) : null}
    </div>
  );
}

function ColorButton({
  active,
  children,
  color,
  label,
  onClick,
}: {
  active: boolean;
  children?: ReactNode;
  color?: string;
  label: string;
  onClick: () => void;
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
          ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-100 dark:text-gray-900"
          : "border-transparent hover:bg-gray-100/80 dark:hover:bg-white/[0.06]",
        color
          ? "h-7 w-7 bg-transparent p-1"
          : "h-7 px-2.5 text-[11px] font-medium text-gray-600 dark:text-gray-300",
      )}
    >
      {color ? (
        <span
          className={cn(
            "h-full w-full rounded-full border border-black/10",
            active && "ring-1 ring-white/70 dark:ring-black/20",
          )}
          style={{ backgroundColor: color }}
        />
      ) : (
        children
      )}
    </button>
  );
}

function FilterChip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-1 text-[12px] transition-colors hover:text-gray-900 dark:hover:text-gray-100"
    >
      {children}
      <X className="h-3 w-3" />
    </button>
  );
}

function ToolbarButton({
  active,
  ariaExpanded,
  icon: Icon,
  label,
  onClick,
  trailing,
  valueLabel,
}: {
  active: boolean;
  ariaExpanded?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  trailing?: ReactNode;
  valueLabel?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors",
        active
          ? "bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
          : "text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-gray-100",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
      {valueLabel ? (
        <span className="max-w-[120px] truncate text-gray-400">{valueLabel}</span>
      ) : null}
      {trailing}
    </button>
  );
}

function ToolbarSelectField({
  active,
  children,
  icon: Icon,
  label,
}: {
  active: boolean;
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition-colors",
        active
          ? "bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
          : "text-gray-600 hover:bg-gray-100/80 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-gray-100",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
      {children}
    </div>
  );
}

function InlineField({
  children,
  icon: Icon,
  label,
}: {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="inline-flex min-h-8 items-center gap-2 rounded-full bg-gray-100/75 px-3 py-1 dark:bg-white/[0.05]">
      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      <span className="text-[12px] text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {Array.isArray(children)
          ? children.map((child, index) =>
              typeof child === "string" ? (
                <span key={index} className="text-[12px] text-gray-400">
                  {child}
                </span>
              ) : (
                child
              ),
            )
          : children}
      </div>
    </div>
  );
}

function Input(props: React.ComponentProps<typeof BaseInput>) {
  return <BaseInput {...props} className={cn(INLINE_INPUT_CLASS_NAME, props.className)} />;
}
