import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { appTagPillClass } from "@/lib/ui";
import type { Tag as FileTag } from "@/stores/fileTypes";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useTagStore } from "@/stores/tagStore";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const normalizeTagName = (value: string) => value.trim().toLocaleLowerCase();

const getMatchScore = (name: string, query: string) => {
  const normalizedName = normalizeTagName(name);

  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;

  const matchIndex = normalizedName.indexOf(query);
  return matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex + 2;
};

type SuggestionTag = ReturnType<typeof useTagStore.getState>["flatTags"][number];

type SuggestionItem =
  | {
      id: string;
      type: "tag";
      tag: SuggestionTag;
    }
  | {
      id: string;
      type: "create";
      name: string;
    };

interface FileTagInputProps {
  fileId: number;
  fileTags: FileTag[];
}

export default function FileTagInput({ fileId, fileTags }: FileTagInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const addTagToFile = useLibraryQueryStore((state) => state.addTagToFile);
  const removeTagFromFile = useLibraryQueryStore((state) => state.removeTagFromFile);
  const { flatTags, addTag } = useTagStore();
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const trimmedInput = tagInput.trim();
  const normalizedInput = normalizeTagName(tagInput);
  const listboxId = `file-tag-suggestions-${fileId}`;

  const availableTags = flatTags.filter(
    (tag) => !fileTags.some((fileTag) => fileTag.id === tag.id),
  );

  const filteredTags = normalizedInput
    ? [...availableTags]
        .filter((tag) => normalizeTagName(tag.name).includes(normalizedInput))
        .sort((a, b) => {
          const scoreDiff =
            getMatchScore(a.name, normalizedInput) - getMatchScore(b.name, normalizedInput);

          if (scoreDiff !== 0) return scoreDiff;

          return a.name.localeCompare(b.name, "zh-CN");
        })
    : [];

  const exactExistingTag = trimmedInput
    ? flatTags.find((tag) => normalizeTagName(tag.name) === normalizedInput)
    : undefined;

  const suggestionItems: SuggestionItem[] = [
    ...filteredTags.map((tag) => ({
      id: `tag-${tag.id}`,
      type: "tag" as const,
      tag,
    })),
    ...(trimmedInput && !exactExistingTag
      ? [
          {
            id: "create-tag",
            type: "create" as const,
            name: trimmedInput,
          },
        ]
      : []),
  ];

  const isDropdownOpen = showSuggestions && suggestionItems.length > 0;
  const activeSuggestion = isDropdownOpen ? suggestionItems[activeSuggestionIndex] : undefined;

  useEffect(() => {
    setTagInput("");
    setShowSuggestions(false);
    setActiveSuggestionIndex(0);
  }, [fileId]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [tagInput, fileTags.length]);

  useEffect(() => {
    if (suggestionItems.length === 0) {
      setActiveSuggestionIndex(0);
      return;
    }

    setActiveSuggestionIndex((current) => Math.min(current, suggestionItems.length - 1));
  }, [suggestionItems.length]);

  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const clearComposer = () => {
    setTagInput("");
    setShowSuggestions(false);
    setActiveSuggestionIndex(0);
  };

  const handleAddExistingTag = async (tagId: number) => {
    await addTagToFile(fileId, tagId);
    clearComposer();
    focusInput();
  };

  const handleCreateTag = async () => {
    if (!trimmedInput) return;

    const randomColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

    await addTag(trimmedInput, randomColor);

    const createdTag = useTagStore
      .getState()
      .flatTags.find((tag) => normalizeTagName(tag.name) === normalizedInput);

    if (createdTag) {
      await addTagToFile(fileId, createdTag.id);
    }

    clearComposer();
    focusInput();
  };

  const commitSuggestion = async (item?: SuggestionItem) => {
    if (item?.type === "tag") {
      await handleAddExistingTag(item.tag.id);
      return;
    }

    if (item?.type === "create") {
      await handleCreateTag();
      return;
    }

    if (!trimmedInput) return;

    if (exactExistingTag) {
      const isAttached = fileTags.some((tag) => tag.id === exactExistingTag.id);
      if (!isAttached) {
        await handleAddExistingTag(exactExistingTag.id);
      }
      return;
    }

    await handleCreateTag();
  };

  const handleKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestionItems.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestionIndex((current) => Math.min(current + 1, suggestionItems.length - 1));
      return;
    }

    if (event.key === "ArrowUp" && suggestionItems.length > 0) {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestionIndex(0);
      return;
    }

    if (event.nativeEvent.isComposing) return;

    if ((event.key === "Enter" || event.key === " ") && trimmedInput) {
      event.preventDefault();
      await commitSuggestion(activeSuggestion ?? suggestionItems[0]);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setShowSuggestions(false);
    setActiveSuggestionIndex(0);
  };

  return (
    <div
      className="relative"
      onBlur={handleBlur}
      onFocus={() => {
        if (trimmedInput) {
          setShowSuggestions(true);
        }
      }}
    >
      <div
        className="flex min-h-[34px] w-full cursor-text flex-wrap items-center gap-1 rounded-[10px] border border-gray-300/90 bg-white/70 px-2 py-1 text-[13px] text-gray-800 shadow-sm transition-[border-color,box-shadow,background-color] focus-within:border-transparent focus-within:bg-white focus-within:ring-2 focus-within:ring-primary-500 dark:border-gray-600 dark:bg-dark-bg/60 dark:text-gray-200 dark:focus-within:bg-dark-surface"
        onClick={() => inputRef.current?.focus()}
      >
        {fileTags.map((tag) => (
          <span key={tag.id} className={appTagPillClass} style={{ backgroundColor: tag.color }}>
            <span className="truncate">{tag.name}</span>
            <button
              type="button"
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full transition-opacity hover:bg-white/15"
              onClick={() => void removeTagFromFile(fileId, tag.id)}
              title={`移除标签 ${tag.name}`}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={tagInput}
          className="input-system-font h-7 min-w-[88px] flex-1 border-0 bg-transparent px-1 py-0 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-gray-200"
          placeholder={"添加标签"}
          aria-autocomplete="list"
          aria-controls={isDropdownOpen ? listboxId : undefined}
          aria-expanded={isDropdownOpen}
          aria-activedescendant={
            activeSuggestion ? `${listboxId}-${activeSuggestion.id}` : undefined
          }
          onChange={(event) => {
            const nextValue = event.target.value;
            setTagInput(nextValue);
            setShowSuggestions(nextValue.trim().length > 0);
          }}
          onFocus={() => {
            if (trimmedInput) {
              setShowSuggestions(true);
            }
          }}
          onKeyDown={(event) => {
            void handleKeyDown(event);
          }}
        />
      </div>

      {isDropdownOpen && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-[12px] border border-gray-200 bg-white shadow-xl dark:border-dark-border dark:bg-dark-surface"
        >
          {suggestionItems.map((item, index) => {
            const isActive = index === activeSuggestionIndex;

            if (item.type === "tag") {
              return (
                <button
                  key={item.id}
                  id={`${listboxId}-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors",
                    isActive
                      ? "bg-gray-100 dark:bg-dark-border"
                      : "hover:bg-gray-50 dark:hover:bg-dark-border/80",
                  )}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => void handleAddExistingTag(item.tag.id)}
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: item.tag.color }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300"
                    style={{ paddingLeft: `${item.tag.depth * 10}px` }}
                  >
                    {item.tag.name}
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                    复用
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                id={`${listboxId}-${item.id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-gray-100 dark:bg-dark-border"
                    : "hover:bg-gray-50 dark:hover:bg-dark-border/80",
                )}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
                onClick={() => void handleCreateTag()}
              >
                <svg
                  className="h-3 w-3 flex-shrink-0 text-primary-600 dark:text-primary-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 4v16m8-8H4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
                <span className="min-w-0 flex-1 truncate text-primary-600 dark:text-primary-400">
                  创建标签 "{item.name}"
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
