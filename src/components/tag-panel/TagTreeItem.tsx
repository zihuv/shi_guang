import { useEffect, useMemo, useRef } from "react";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { Button } from "@/components/ui/Button";
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
import { appPanelMetaClass, appTreeRowClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { flattenTagTree, type Tag, useTagStore } from "@/stores/tagStore";
import { Bookmark, ChevronRight, Move, Pencil, Plus, Trash2 } from "lucide-react";
import {
  findTagParentId,
  findTagSiblings,
  isDescendant,
  type DragPosition,
} from "@/components/tag-panel/tagTreeUtils";

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

export function TagItem({
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
                  ? "bg-black/[0.055] text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
                  : "hover:bg-black/[0.045] dark:hover:bg-white/[0.06]",
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
                className="size-5 p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(tag.id);
                }}
              >
                <ChevronRight
                  className={cn(
                    "size-3 text-gray-500 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </Button>
            ) : (
              <span className="size-5" />
            )}

            <span
              className="size-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{tag.name}</span>
            {tag.count > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{tag.count}</span>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onViewFiles(tag)}>
            <Bookmark className="mr-2 size-4" />
            查看素材
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onAddChild(tag)}>
            <Plus className="mr-2 size-4" />
            创建子标签
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onEdit(tag)}>
            <Pencil className="mr-2 size-4" />
            重命名
          </ContextMenuItem>
          <MoveTagMenu tag={tag} />
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => onDelete(tag)}
            className="text-red-600 dark:text-red-400"
          >
            <Trash2 className="mr-2 size-4" />
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
        <Move className="mr-2 size-4" />
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
