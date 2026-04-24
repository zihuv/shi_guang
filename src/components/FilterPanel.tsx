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
  "!h-7 !min-h-0 !justify-start !gap-0.5 !rounded-none !border-transparent !bg-transparent !px-0 !py-0 !text-[12px] !font-medium !text-gray-700 !shadow-none hover:!border-transparent hover:!bg-transparent dark:!text-gray-200 [&_svg]:!ml-0";

const INLINE_INPUT_CLASS_NAME =
  "h-7 rounded-none border-transparent bg-transparent px-0 text-[12px] text-gray-700 shadow-none placeholder:text-gray-400 focus:border-transparent focus:bg-transparent focus:ring-0 dark:text-gray-200";

function getFileTypeDisplay(type: string) {
  return FILE_TYPES.find((item) => item.value === type)?.label ?? "全部类型";
}

function getRatingDisplay(rating: number) {
  return RATING_OPTIONS.find((item) => Number(item.value) === rating)?.label ?? "评分";
}

function getColorDisplay(color: string | null) {
  if (!color) return "全部";
  return PRESET_COLORS.find((item) => item.value === color)?.name ?? "颜色";
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
  const colorMenuRef = useRef<HTMLDivElement>(null);

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
  const [showColorMenu, setShowColorMenu] = useState(false);

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
    if (!showColorMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!colorMenuRef.current?.contains(event.target as Node)) {
        setShowColorMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showColorMenu]);

  const tagDisplay =
    criteria.tagIds.length === 0
      ? "全部标签"
      : criteria.tagIds.length === 1
        ? (flatTags.find((tag) => tag.id === criteria.tagIds[0])?.name ?? "标签")
        : `${criteria.tagIds.length} 个标签`;

  return (
    <div className="flex w-full flex-col gap-2 pb-1 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <div ref={colorMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setShowColorMenu((current) => !current)}
              aria-pressed={Boolean(criteria.dominantColor)}
              aria-expanded={showColorMenu}
              aria-label={`颜色：${getColorDisplay(criteria.dominantColor)}`}
              title={`颜色：${getColorDisplay(criteria.dominantColor)}`}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors",
                criteria.dominantColor
                  ? "bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
                  : "text-gray-500 hover:bg-gray-100/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-gray-100",
              )}
            >
              <Palette className="h-3.5 w-3.5 shrink-0" />
              {criteria.dominantColor ? (
                <span
                  className="h-2.5 w-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: criteria.dominantColor }}
                />
              ) : null}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {getColorDisplay(criteria.dominantColor)}
              </span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showColorMenu && "rotate-180")}
              />
            </button>

            {showColorMenu && (
              <div className="absolute left-0 top-9 z-30 w-[210px] rounded-xl bg-white/98 p-2 shadow-[0_14px_36px_rgba(15,23,42,0.14)] backdrop-blur dark:bg-dark-surface/98 dark:shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                <div className="grid grid-cols-6 gap-1">
                  <ColorButton
                    active={criteria.dominantColor === null}
                    className="col-span-2 w-full"
                    label="全部颜色"
                    onClick={() => {
                      setDominantColor(null);
                      setShowColorMenu(false);
                    }}
                  >
                    全部
                  </ColorButton>
                  {PRESET_COLORS.map((color) => (
                    <ColorButton
                      key={color.value}
                      active={criteria.dominantColor === color.value}
                      className="justify-self-center"
                      color={color.value}
                      label={color.name}
                      onClick={() => {
                        setDominantColor(color.value);
                        setShowColorMenu(false);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <CompactField icon={Bookmark} label="标签" active={criteria.tagIds.length > 0}>
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
              className="max-w-[180px]"
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
          </CompactField>

          <CompactField icon={FileCode2} label="格式" active={criteria.fileType !== "all"}>
            <Select
              value={criteria.fileType}
              displayValue={
                criteria.fileType !== "all" ? getFileTypeDisplay(criteria.fileType) : "全部"
              }
              onValueChange={(value) =>
                setFileType(value as "all" | "image" | "video" | "document")
              }
              className="max-w-[120px]"
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
          </CompactField>

          <CompactField icon={Star} label="评分" active={criteria.minRating > 0}>
            <Select
              value={String(criteria.minRating)}
              displayValue={criteria.minRating > 0 ? getRatingDisplay(criteria.minRating) : "全部"}
              onValueChange={(value) => setMinRating(Number(value))}
              className="max-w-[120px]"
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
          </CompactField>

          <button
            type="button"
            onClick={() => setShowAdvanced((current) => !current)}
            aria-pressed={showAdvanced || hasAdvancedFilters}
            aria-expanded={showAdvanced}
            aria-label="更多筛选"
            title="更多筛选"
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors",
              showAdvanced || hasAdvancedFilters
                ? "bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
                : "text-gray-500 hover:bg-gray-100/80 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            {advancedFilterCount > 0 ? (
              <span className="rounded bg-gray-200 px-1 text-[10px] font-medium leading-4 text-gray-600 dark:bg-white/10 dark:text-gray-300">
                {advancedFilterCount}
              </span>
            ) : null}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")}
            />
          </button>
        </div>

        <button
          type="button"
          onClick={clearFilters}
          disabled={activeCount === 0}
          title="清空筛选"
          aria-label="清空筛选"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-gray-500 transition-colors hover:bg-gray-100/80 hover:text-gray-800 disabled:cursor-default disabled:opacity-35 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-1.5">
          <InlineField icon={Search} label="关键词" active={Boolean(criteria.keyword.trim())}>
            <Input
              value={criteria.keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="备注 / 来源"
              className="min-w-[150px] sm:min-w-[170px]"
            />
          </InlineField>

          <InlineField
            icon={CalendarRange}
            label="时间"
            active={Boolean(criteria.dateRange.start || criteria.dateRange.end)}
          >
            <Input
              type="date"
              value={criteria.dateRange.start ?? ""}
              onChange={(event) =>
                setDateRange({ ...criteria.dateRange, start: event.target.value || null })
              }
              className="w-[126px]"
            />
            <span className="text-[12px] text-gray-400">至</span>
            <Input
              type="date"
              value={criteria.dateRange.end ?? ""}
              onChange={(event) =>
                setDateRange({ ...criteria.dateRange, end: event.target.value || null })
              }
              className="w-[126px]"
            />
          </InlineField>

          <InlineField
            icon={FileCode2}
            label="大小"
            active={criteria.sizeRange.min !== null || criteria.sizeRange.max !== null}
          >
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
              className="w-[82px]"
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
              className="w-[82px]"
            />
          </InlineField>

          {activeCount > 0 ? (
            <span className="px-1 text-[12px] text-gray-400 dark:text-gray-500">
              已筛选 {activeCount} 项
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ColorButton({
  active,
  children,
  className,
  color,
  label,
  onClick,
}: {
  active: boolean;
  children?: ReactNode;
  className?: string;
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
        "flex h-6 items-center justify-center rounded-md border transition-colors",
        active
          ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-100 dark:text-gray-900"
          : "border-transparent text-gray-500 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-white/[0.06]",
        color ? "w-6 bg-transparent p-1" : "px-1.5 text-[11px] font-medium",
        className,
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

function CompactField({
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
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors",
        active
          ? "bg-gray-100 text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
          : "text-gray-500 hover:bg-gray-100/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.05] dark:hover:text-gray-100",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {children}
    </div>
  );
}

function InlineField({
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
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex min-h-8 items-center gap-2 rounded-lg px-2 py-0.5 transition-colors",
        active ? "bg-gray-100 dark:bg-white/[0.08]" : "bg-gray-100/60 dark:bg-white/[0.04]",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
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
