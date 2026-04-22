import { useEffect, useMemo, useRef, useState } from "react";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  buildVisibleTreeItems,
  useTreeKeyboardNavigation,
} from "@/hooks/useTreeKeyboardNavigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import { requestFocusFirstFile } from "@/lib/libraryNavigation";
import { appPanelMetaClass, appTreeRowClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/stores/filterStore";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { collectTagIds, flattenTagTree, type Tag, useTagStore } from "@/stores/tagStore";
import {
  Bookmark,
  ChevronRight,
  Move,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
];

type DragPosition = { type: "none" } | { type: "sort"; targetId: number; before: boolean };

const findTagParentId = (
  tags: Tag[],
  tagId: number,
  parentId: number | null = null,
): number | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return parentId;
    if (tag.children.length > 0) {
      const found = findTagParentId(tag.children, tagId, tag.id);
      if (found !== null) return found;
    }
  }
  return null;
};

const findTagById = (tags: Tag[], tagId: number): Tag | null => {
  for (const tag of tags) {
    if (tag.id === tagId) return tag;
    const found = findTagById(tag.children, tagId);
    if (found) return found;
  }
  return null;
};

const findTagSiblings = (tags: Tag[], parentId: number | null): Tag[] => {
  if (parentId === null) return tags;
  const parent = findTagById(tags, parentId);
  return parent?.children ?? [];
};

const isDescendant = (tags: Tag[], parentId: number, childId: number): boolean => {
  const parent = findTagById(tags, parentId);
  if (!parent) return false;

  const check = (nodes: Tag[]): boolean => {
    for (const node of nodes) {
      if (node.id === childId) return true;
      if (check(node.children)) return true;
    }
    return false;
  };

  return check(parent.children);
};

function filterTagTree(tags: Tag[], query: string): Tag[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return tags;
  }

  return tags.flatMap((tag) => {
    const filteredChildren = filterTagTree(tag.children, normalizedQuery);
    const matches = tag.name.toLocaleLowerCase().includes(normalizedQuery);
    if (!matches && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...tag,
        children: filteredChildren,
      },
    ];
  });
}

interface TagItemProps {
  tag: Tag;
  depth: number;
  activeId: number | null;
  dragPosition: DragPosition;
  expandedIds: number[];
  onToggle: (id: number) => void;
  onSelect: (id: number | null) => void;
  onEdit: (tag: Tag) => void;
  onDelete: (tag: Tag) => void;
  onAddChild: (tag: Tag) => void;
  onViewFiles: (tag: Tag) => void;
  onOpenFiles: (tag: Tag) => void;
  focusPanel: () => void;
  registerKeyboardItem: (tagId: number, element: HTMLDivElement | null) => void;
}

function TagItem({
  tag,
  depth,
  activeId,
  dragPosition,
  expandedIds,
  onToggle,
  onSelect,
  onEdit,
  onDelete,
  onAddChild,
  onViewFiles,
  onOpenFiles,
  focusPanel,
  registerKeyboardItem,
}: TagItemProps) {
  const selectedTagId = useTagStore((state) => state.selectedTagId);
  const elementRef = useRef<HTMLDivElement>(null);
  const isExpanded = expandedIds.includes(tag.id);
  const isSelected = selectedTagId === tag.id;
  const hasChildren = tag.children.length > 0;
  const isDragging = activeId === tag.id;
  const isSortTarget =
    dragPosition.type === "sort" && dragPosition.targetId === tag.id && !isDragging;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: "tag",
          tagId: tag.id,
        }),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element }) =>
          attachClosestEdge(
            {
              type: "tag" as const,
              tagId: tag.id,
            },
            {
              input,
              element,
              allowedEdges: ["top", "bottom"],
            },
          ),
        canDrop: ({ source }) => source.data.type === "tag" && source.data.tagId !== tag.id,
      }),
    );
  }, [tag.id]);

  return (
    <div>
      {isSortTarget && dragPosition.before && (
        <div
          className="relative my-0.5 h-0.5 rounded-full bg-blue-500"
          style={{ marginLeft: `${depth * 12 + 8}px` }}
        >
          <div className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500" />
        </div>
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={(element) => {
              elementRef.current = element;
              registerKeyboardItem(tag.id, element);
            }}
            className={cn(
              appTreeRowClass,
              "cursor-pointer",
              isDragging
                ? "opacity-50"
                : isSelected
                  ? "bg-primary-100 dark:bg-primary-900/30"
                  : "hover:bg-gray-100 dark:hover:bg-dark-border",
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => {
              focusPanel();
              onSelect(tag.id);
            }}
            onDoubleClick={() => {
              focusPanel();
              onOpenFiles(tag);
            }}
          >
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(tag.id);
                }}
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 text-gray-500 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </Button>
            ) : (
              <span className="w-5" />
            )}

            <TagIcon className="h-4 w-4 flex-shrink-0" style={{ color: tag.color }} />
            <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{tag.name}</span>
            {tag.count > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{tag.count}</span>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onViewFiles(tag)}>
            <Bookmark className="mr-2 h-4 w-4" />
            查看素材
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onAddChild(tag)}>
            <Plus className="mr-2 h-4 w-4" />
            创建子标签
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onEdit(tag)}>
            <Pencil className="mr-2 h-4 w-4" />
            重命名
          </ContextMenuItem>
          <MoveTagMenu tag={tag} />
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => onDelete(tag)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-1">
          {tag.children.map((child) => (
            <TagItem
              key={child.id}
              tag={child}
              depth={depth + 1}
              activeId={activeId}
              dragPosition={dragPosition}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onViewFiles={onViewFiles}
              onOpenFiles={onOpenFiles}
              focusPanel={focusPanel}
              registerKeyboardItem={registerKeyboardItem}
            />
          ))}
        </div>
      )}

      {isSortTarget && !dragPosition.before && (
        <div
          className="relative my-0.5 h-0.5 rounded-full bg-blue-500"
          style={{ marginLeft: `${depth * 12 + 8}px` }}
        >
          <div className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500" />
        </div>
      )}
    </div>
  );
}

function MoveTagMenu({ tag }: { tag: Tag }) {
  const tags = useTagStore((state) => state.tags);
  const moveTag = useTagStore((state) => state.moveTag);
  const reorderTags = useTagStore((state) => state.reorderTags);
  const flatTags = useMemo(() => flattenTagTree(tags), [tags]);

  const options = flatTags.filter(
    (item) => item.id !== tag.id && !isDescendant(tags, tag.id, item.id),
  );

  const moveTo = async (newParentId: number | null) => {
    const currentParentId = findTagParentId(tags, tag.id);
    const oldSiblings = findTagSiblings(tags, currentParentId).filter((item) => item.id !== tag.id);
    const newSiblings = [
      ...findTagSiblings(tags, newParentId).filter((item) => item.id !== tag.id),
      tag,
    ];

    await moveTag(tag.id, newParentId, newSiblings.length - 1);

    if (currentParentId !== newParentId && oldSiblings.length > 0) {
      await reorderTags(
        oldSiblings.map((item) => item.id),
        currentParentId,
      );
    }
  };

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Move className="mr-2 h-4 w-4" />
        移动到
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => moveTo(null)}>根标签</ContextMenuItem>
        {options.map((item) => (
          <ContextMenuItem
            key={item.id}
            onSelect={() => moveTo(item.id)}
            style={{ paddingLeft: `${item.depth * 12 + 8}px` }}
          >
            {item.name}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export default function TagPanel() {
  const tags = useTagStore((state) => state.tags);
  const addTag = useTagStore((state) => state.addTag);
  const deleteTag = useTagStore((state) => state.deleteTag);
  const updateTag = useTagStore((state) => state.updateTag);
  const reorderTags = useTagStore((state) => state.reorderTags);
  const selectedTagId = useTagStore((state) => state.selectedTagId);
  const setSelectedTagId = useTagStore((state) => state.setSelectedTagId);
  const selectFolder = useFolderStore((state) => state.selectFolder);
  const runCurrentQuery = useLibraryQueryStore((state) => state.runCurrentQuery);
  const setSelectedFolderId = useLibraryQueryStore((state) => state.setSelectedFolderId);
  const setTagIds = useFilterStore((state) => state.setTagIds);
  const setFolderId = useFilterStore((state) => state.setFolderId);
  const openLibrary = useNavigationStore((state) => state.openLibrary);

  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addingParent, setAddingParent] = useState<Tag | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<DragPosition>({ type: "none" });
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);

  const filteredTags = useMemo(() => filterTagTree(tags, searchQuery), [searchQuery, tags]);
  const effectiveExpandedIds = useMemo(() => {
    if (!searchQuery.trim()) {
      return expandedIds;
    }
    return flattenTagTree(filteredTags)
      .filter((tag) => tag.children.length > 0)
      .map((tag) => tag.id);
  }, [expandedIds, filteredTags, searchQuery]);
  const selectedTag = useMemo(
    () => (selectedTagId === null ? null : findTagById(tags, selectedTagId)),
    [selectedTagId, tags],
  );
  const selectedTagChildren = selectedTag?.children ?? [];

  const visibleTagItems = useMemo(
    () =>
      buildVisibleTreeItems(filteredTags, {
        expandedIds: effectiveExpandedIds,
        getId: (tag) => tag.id,
        getChildren: (tag) => tag.children,
      }),
    [effectiveExpandedIds, filteredTags],
  );

  const {
    containerRef: panelRef,
    focusContainer: focusPanel,
    registerItem: registerKeyboardItem,
    handleKeyDown: handlePanelKeyDown,
  } = useTreeKeyboardNavigation({
    items: visibleTagItems,
    selectedId: selectedTagId,
    onSelect: async (tagId) => {
      focusPanel();
      setSelectedTagId(tagId);
    },
    onToggle: (tagId) => {
      setExpandedIds((previous) =>
        previous.includes(tagId)
          ? previous.filter((item) => item !== tagId)
          : [...previous, tagId],
      );
    },
    onActivate: requestFocusFirstFile,
  });

  useEffect(() => {
    setExpandedIds((previous) => {
      const validIds = new Set(flattenTagTree(tags).map((tag) => tag.id));
      const next = previous.filter((id) => validIds.has(id));
      const parents = flattenTagTree(tags)
        .filter((tag) => tag.children.length > 0)
        .map((tag) => tag.id);
      return Array.from(new Set([...next, ...parents]));
    });
  }, [tags]);

  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === "tag") {
          setActiveId(source.data.tagId as number);
        }
      },
      onDrag: ({ source, location }) => {
        if (source.data.type !== "tag") return;
        const target = location.current.dropTargets[0];
        if (!target || target.data.type !== "tag") {
          setDragPosition({ type: "none" });
          return;
        }

        const closestEdge = extractClosestEdge(target.data);
        if (!closestEdge) {
          setDragPosition({ type: "none" });
          return;
        }

        setDragPosition({
          type: "sort",
          targetId: target.data.tagId as number,
          before: closestEdge === "top",
        });
      },
      onDrop: async ({ source, location }) => {
        if (source.data.type !== "tag") {
          setActiveId(null);
          setDragPosition({ type: "none" });
          return;
        }

        const activeTagId = source.data.tagId as number;
        const target = location.current.dropTargets[0];

        if (!target || target.data.type !== "tag") {
          setActiveId(null);
          setDragPosition({ type: "none" });
          return;
        }

        const targetTagId = target.data.tagId as number;
        if (activeTagId === targetTagId) {
          setActiveId(null);
          setDragPosition({ type: "none" });
          return;
        }

        const before = extractClosestEdge(target.data) === "top";
        const activeParentId = findTagParentId(tags, activeTagId);
        const targetParentId = findTagParentId(tags, targetTagId);
        const targetSiblings = [...findTagSiblings(tags, targetParentId)];
        const activeIndexInTarget = targetSiblings.findIndex((item) => item.id === activeTagId);

        if (activeIndexInTarget !== -1) {
          targetSiblings.splice(activeIndexInTarget, 1);
        }

        const targetIndex = targetSiblings.findIndex((item) => item.id === targetTagId);
        const insertIndex = before ? targetIndex : targetIndex + 1;
        const movedTag = findTagById(tags, activeTagId);

        if (targetIndex === -1 || !movedTag) {
          setActiveId(null);
          setDragPosition({ type: "none" });
          return;
        }

        targetSiblings.splice(insertIndex, 0, movedTag);
        await reorderTags(
          targetSiblings.map((item) => item.id),
          targetParentId,
        );

        if (activeParentId !== targetParentId) {
          const oldSiblings = findTagSiblings(tags, activeParentId).filter(
            (item) => item.id !== activeTagId,
          );
          if (oldSiblings.length > 0) {
            await reorderTags(
              oldSiblings.map((item) => item.id),
              activeParentId,
            );
          }
        }

        setActiveId(null);
        setDragPosition({ type: "none" });
      },
    });
  }, [reorderTags, tags]);

  const openAddDialog = (parent: Tag | null = null) => {
    setAddingParent(parent);
    setIsAdding(true);
    setNewTagName("");
    setSelectedColor(parent?.color ?? TAG_COLORS[0]);
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    await addTag(newTagName.trim(), selectedColor, addingParent?.id ?? null);
    if (addingParent) {
      setExpandedIds((previous) => Array.from(new Set([...previous, addingParent.id])));
    }
    setIsAdding(false);
    setAddingParent(null);
    setNewTagName("");
    setSelectedColor(TAG_COLORS[0]);
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const handleSaveTag = async () => {
    if (!editingTag || !editName.trim()) return;
    await updateTag(editingTag.id, editName.trim(), editColor);
    setEditingTag(null);
    setEditName("");
    setEditColor("");
  };

  const confirmDeleteTag = async () => {
    if (!deletingTag) return;

    if (deletingTag.id === selectedTagId) {
      setSelectedTagId(null);
    }
    await deleteTag(deletingTag.id);
    setDeletingTag(null);
  };

  const openFilesForTag = async (tag: Tag) => {
    setTagIds(collectTagIds(tag));
    setSelectedTagId(tag.id);
    setFolderId(null);
    selectFolder(null);
    setSelectedFolderId(null);
    await runCurrentQuery(null);
    openLibrary();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-dark-bg">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-dark-border">
        <h2 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">标签管理</h2>
        <Button variant="outline" onClick={() => openAddDialog()} className="h-8 rounded-lg px-3">
          <Plus className="mr-1 h-4 w-4" />
          新建标签
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-h-0 w-[300px] flex-shrink-0 flex-col border-r border-gray-200 dark:border-dark-border">
          <div className="border-b border-gray-200 px-3 py-3 dark:border-dark-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索标签"
                className="h-8 rounded-lg border-gray-200 bg-white pl-9 shadow-none dark:border-dark-border dark:bg-dark-bg/70"
              />
            </div>
          </div>

          <div
            ref={panelRef}
            className="flex-1 overflow-auto p-2.5 focus:outline-none"
            tabIndex={0}
            onKeyDown={handlePanelKeyDown}
          >
            <div className="flex flex-col gap-1">
              {filteredTags.map((tag) => (
                <TagItem
                  key={tag.id}
                  tag={tag}
                  depth={0}
                  activeId={activeId}
                  dragPosition={dragPosition}
                  expandedIds={effectiveExpandedIds}
                  onToggle={(tagId) =>
                    setExpandedIds((previous) =>
                      previous.includes(tagId)
                        ? previous.filter((item) => item !== tagId)
                        : [...previous, tagId],
                    )
                  }
                  onSelect={setSelectedTagId}
                  onEdit={handleEditTag}
                  onDelete={setDeletingTag}
                  onAddChild={openAddDialog}
                  onViewFiles={(tag) => void openFilesForTag(tag)}
                  onOpenFiles={(tag) => void openFilesForTag(tag)}
                  focusPanel={focusPanel}
                  registerKeyboardItem={registerKeyboardItem}
                />
              ))}

              {filteredTags.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-gray-400 dark:text-gray-500">
                  没有匹配结果
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col">
          {selectedTag ? (
            <>
              <div className="border-b border-gray-200 px-5 py-4 dark:border-dark-border">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${selectedTag.color}1f`, color: selectedTag.color }}
                  >
                    <TagIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-[16px] font-semibold text-gray-900 dark:text-gray-100">
                      {selectedTag.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-gray-500 dark:text-gray-400">
                      <span>{selectedTag.count} 个素材</span>
                      <span>{selectedTagChildren.length} 个子标签</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <div className="border-b border-gray-200 px-5 py-4 dark:border-dark-border">
                  <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-y-2 text-[13px]">
                    <span className="text-gray-500 dark:text-gray-400">颜色</span>
                    <span className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: selectedTag.color }}
                      />
                      {selectedTag.color}
                    </span>
                  </div>
                </div>

                <div className="px-3 py-2">
                  {selectedTagChildren.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {selectedTagChildren.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => setSelectedTagId(child.id)}
                          onDoubleClick={() => void openFilesForTag(child)}
                          className={`${appTreeRowClass} hover:bg-gray-100 dark:hover:bg-dark-border`}
                        >
                          <span
                            className="h-3 w-3 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: child.color }}
                          />
                          <span className="flex-1 truncate text-left text-gray-800 dark:text-gray-100">
                            {child.name}
                          </span>
                          <span className={`${appPanelMetaClass} tabular-nums`}>{child.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-2.5 py-3 text-[12px] text-gray-400 dark:text-gray-500">
                      暂无子标签
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-[13px] text-gray-400 dark:text-gray-500">选择标签</div>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={isAdding}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setIsAdding(false);
            setAddingParent(null);
            setNewTagName("");
            setSelectedColor(TAG_COLORS[0]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{addingParent ? "创建子标签" : "创建标签"}</DialogTitle>
            {addingParent && (
              <DialogDescription>在 “{addingParent.name}” 下创建子标签</DialogDescription>
            )}
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Input
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void handleAddTag()}
              placeholder="标签名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform",
                    selectedColor === color && "scale-110 ring-2 ring-gray-400 ring-offset-2",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setIsAdding(false);
                setAddingParent(null);
                setNewTagName("");
                setSelectedColor(TAG_COLORS[0]);
              }}
            >
              取消
            </Button>
            <Button onClick={() => void handleAddTag()}>添加</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingTag}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setEditingTag(null);
            setEditName("");
            setEditColor("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void handleSaveTag()}
              placeholder="新名称"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setEditColor(color)}
                  className={cn(
                    "h-6 w-6 rounded-full transition-transform",
                    editColor === color && "scale-110 ring-2 ring-gray-400 ring-offset-2",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditingTag(null);
                setEditName("");
                setEditColor("");
              }}
            >
              取消
            </Button>
            <Button onClick={() => void handleSaveTag()}>保存</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deletingTag}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setDeletingTag(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除标签</DialogTitle>
            <DialogDescription>
              {deletingTag
                ? `删除 “${deletingTag.name}” 后，该标签及其子标签会从所有已关联素材中移除，且无法恢复。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeletingTag(null)}>
              取消
            </Button>
            <Button
              onClick={() => void confirmDeleteTag()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
