import { useEffect, useMemo, useRef, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
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
import { TagItem } from "@/components/tag-panel/TagTreeItem";
import {
  TAG_COLORS,
  filterTagTree,
  findTagById,
  findTagParentId,
  findTagSiblings,
  type DragPosition,
} from "@/components/tag-panel/tagTreeUtils";
import { requestFocusFirstFile } from "@/lib/libraryNavigation";
import {
  appPanelClass,
  appPanelHeaderClass,
  appPanelMetaClass,
  appPanelTitleClass,
  appTreeRowClass,
} from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/stores/filterStore";
import { useFolderStore } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { collectTagIds, flattenTagTree, type Tag, useTagStore } from "@/stores/tagStore";
import { Plus, Search, Tag as TagIcon } from "lucide-react";

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
  const childSelectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        previous.includes(tagId) ? previous.filter((item) => item !== tagId) : [...previous, tagId],
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
    return () => {
      if (childSelectTimerRef.current) {
        clearTimeout(childSelectTimerRef.current);
      }
    };
  }, []);

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
    openLibrary("all");
    await runCurrentQuery(null);
  };

  const handleChildTagClick = (tag: Tag) => {
    if (childSelectTimerRef.current) {
      clearTimeout(childSelectTimerRef.current);
    }

    childSelectTimerRef.current = setTimeout(() => {
      setSelectedTagId(tag.id);
      childSelectTimerRef.current = null;
    }, 180);
  };

  const handleChildTagDoubleClick = (tag: Tag) => {
    if (childSelectTimerRef.current) {
      clearTimeout(childSelectTimerRef.current);
      childSelectTimerRef.current = null;
    }
    void openFilesForTag(tag);
  };

  return (
    <div className={appPanelClass}>
      <div className={`${appPanelHeaderClass} border-b border-[color:var(--app-border)]`}>
        <h2 className={appPanelTitleClass}>标签管理</h2>
        <Button variant="outline" size="sm" onClick={() => openAddDialog()}>
          <Plus className="h-3.5 w-3.5" />
          新建标签
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-h-0 w-[300px] flex-shrink-0 flex-col border-r border-[color:var(--app-border)]">
          <div className="border-b border-[color:var(--app-border)] px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索标签"
                className="h-8 rounded-lg pl-9"
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
              <div className="flex h-[44px] items-center gap-2 border-b border-[color:var(--app-border)] px-4">
                <TagIcon className="h-4 w-4 flex-shrink-0" style={{ color: selectedTag.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                      {selectedTag.name}
                    </h3>
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: selectedTag.color }}
                    />
                  </div>
                  <div className={appPanelMetaClass}>
                    {selectedTag.count} 个素材 · {selectedTagChildren.length} 个子标签
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                {selectedTagChildren.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {selectedTagChildren.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => handleChildTagClick(child)}
                        onDoubleClick={() => handleChildTagDoubleClick(child)}
                        className={`${appTreeRowClass} hover:bg-gray-100 dark:hover:bg-dark-border`}
                      >
                        <span
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: child.color }}
                        />
                        <span className="flex-1 truncate text-left text-gray-700 dark:text-gray-300">
                          {child.name}
                        </span>
                        <span className={`${appPanelMetaClass} tabular-nums`}>{child.count}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-2.5 py-2 text-[12px] text-gray-400 dark:text-gray-500">
                    暂无子标签
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-[12px] text-gray-400 dark:text-gray-500">选择标签</div>
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
            <DialogDescription>
              {addingParent
                ? `在 “${addingParent.name}” 下创建子标签。`
                : "输入标签名称并选择颜色。"}
            </DialogDescription>
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
            <DialogDescription className="sr-only">
              修改标签名称或颜色，已关联素材会同步更新。
            </DialogDescription>
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
