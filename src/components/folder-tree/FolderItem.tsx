import { useEffect, useRef } from "react";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  Globe,
  Move,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { appPanelMetaClass, appTreeRowClass } from "@/lib/ui";
import { showFolderInExplorer } from "@/services/desktop/system";
import { useFolderStore, type FolderNode } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useSelectionStore } from "@/stores/selectionStore";
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
import type { DragPosition, RegisterTreeItem } from "./types";
import {
  INTERNAL_FILE_DRAG_MIME,
  findFolderParentId,
  findSiblings,
  flattenFolders,
  isDescendant,
} from "./utils";

interface FolderItemProps {
  folder: FolderNode;
  depth: number;
  dragPosition: DragPosition;
  activeId: number | null;
  onDragPositionChange: (position: DragPosition) => void;
  focusTree: () => void;
  onSelectFolder: (folderId: number) => Promise<void>;
  registerKeyboardItem: (folderId: number, element: HTMLDivElement | null) => void;
  registerItem?: RegisterTreeItem;
}

export function FolderItem({
  folder,
  depth,
  dragPosition,
  activeId,
  onDragPositionChange,
  focusTree,
  onSelectFolder,
  registerKeyboardItem,
  registerItem,
}: FolderItemProps) {
  const {
    folders,
    selectedFolderId,
    expandedFolderIds,
    toggleFolder,
    moveFolder,
    reorderFolders,
    uniqueContextId,
    dragOverFolderId,
    setDragOverFolderId,
  } = useFolderStore();
  const currentView = useNavigationStore((state) => state.currentView);
  const { setAddingSubfolder, setEditingFolder, setDeleteConfirm } = useFolderStore();
  const isExpanded = expandedFolderIds.includes(folder.id);
  const isSelected = currentView === "library" && selectedFolderId === folder.id;
  const hasChildren = folder.children && folder.children.length > 0;
  const isSystemFolder = folder.name === "浏览器采集" || folder.isSystem;
  const isBeingDragged = activeId === folder.id;
  const isExternalDragTarget = dragOverFolderId === folder.id;
  const canDrag = !isSystemFolder;

  const draggableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draggableRef.current || !registerItem) return;
    return registerItem({ itemId: folder.id.toString(), element: draggableRef.current });
  }, [folder.id, registerItem]);

  const availableTargets = flattenFolders(folders).filter((target) => {
    if (target.id === folder.id) return false;
    if (isDescendant(folders, folder.id, target.id)) return false;
    if (target.name === "浏览器采集" || target.isSystem) return false;
    return true;
  });

  const menuItems: Array<{ id: number | null; name: string; sortOrder: number }> = [
    { id: null, name: "根目录", sortOrder: -1 },
    ...availableTargets.map((target) => ({
      id: target.id,
      name: target.name,
      sortOrder: target.sortOrder,
    })),
  ];

  const parentId = findFolderParentId(folders, folder.id, null);
  const siblingFolders = findSiblings(folders, parentId).filter(
    (item) => !item.isSystem && item.name !== "浏览器采集",
  );
  const siblingIndex = siblingFolders.findIndex((item) => item.id === folder.id);
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex >= 0 && siblingIndex < siblingFolders.length - 1;

  useEffect(() => {
    const element = draggableRef.current;
    if (!element || !canDrag) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: "folder",
          folderId: folder.id,
          folderName: folder.name,
          uniqueContextId,
        }),
        onDragStart: ({ source }) => {
          onDragPositionChange({ type: "none" });
          const event = new CustomEvent("folder-drag-start", {
            detail: { folderId: source.data.folderId },
            bubbles: true,
          });
          element.dispatchEvent(event);
        },
        onDrop: () => {
          const event = new CustomEvent("folder-drag-end", {
            detail: {},
            bubbles: true,
          });
          element.dispatchEvent(event);
        },
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element }) => {
          const data = {
            type: "folder" as const,
            folderId: folder.id,
            folderName: folder.name,
            hasChildren,
            uniqueContextId,
          };
          return attachClosestEdge(data, {
            input,
            element,
            allowedEdges: ["top", "bottom"],
          });
        },
        canDrop: ({ source }) => {
          if (source.data.uniqueContextId !== uniqueContextId) {
            return false;
          }
          return source.data.type === "folder" && source.data.folderId !== folder.id;
        },
        onDragEnter: ({ source }) => {
          if (source.data.type !== "folder") return;
          const sourceFolderId = source.data.folderId as number;
          if (sourceFolderId === folder.id || isDescendant(folders, sourceFolderId, folder.id)) {
            return;
          }
          onDragPositionChange({ type: "nest", folderId: folder.id });
        },
        onDragLeave: ({ source }) => {
          if (source.data.type !== "folder") return;
          const sourceFolderId = source.data.folderId as number;
          if (isDescendant(folders, folder.id, sourceFolderId)) return;
          if (dragPosition.type === "nest" && dragPosition.folderId === folder.id) {
            onDragPositionChange({ type: "none" });
          }
        },
        onDrop: () => {},
      }),
    );
  }, [
    canDrag,
    dragPosition,
    folder.id,
    folder.name,
    folders,
    hasChildren,
    onDragPositionChange,
    uniqueContextId,
  ]);

  const handleAddSubfolder = () => {
    setAddingSubfolder(folder);
  };

  const handleRename = () => {
    setEditingFolder(folder);
  };

  const handleDelete = () => {
    setDeleteConfirm(folder);
  };

  const handleShowInExplorer = async () => {
    try {
      await showFolderInExplorer(folder.id);
    } catch (error) {
      console.error("Failed to show folder in explorer:", error);
    }
  };

  const moveFolderByStep = async (step: -1 | 1) => {
    if (isSystemFolder) return;
    const nextIndex = siblingIndex + step;
    if (siblingIndex < 0 || nextIndex < 0 || nextIndex >= siblingFolders.length) return;

    const reordered = [...siblingFolders];
    const [moved] = reordered.splice(siblingIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    await reorderFolders(reordered.map((item) => item.id));
  };

  const isInternalFileDrag = (event: React.DragEvent) => {
    if (Array.from(event.dataTransfer.types).includes(INTERNAL_FILE_DRAG_MIME)) {
      return true;
    }

    const { isDraggingInternal, draggedFileIds } = useSelectionStore.getState();
    return isDraggingInternal && draggedFileIds.length > 0;
  };

  const isExternalFileDrag = (event: React.DragEvent) => {
    return Array.from(event.dataTransfer.types).includes("Files");
  };

  const getDraggedFileIds = (event: React.DragEvent) => {
    if (isInternalFileDrag(event)) {
      try {
        const raw = event.dataTransfer.getData(INTERNAL_FILE_DRAG_MIME);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        }
      } catch (error) {
        console.error("Failed to parse internal drag file ids:", error);
      }
    }

    return useSelectionStore.getState().draggedFileIds;
  };

  const handleExternalDragEnter = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(folder.id);
  };

  const handleExternalDragOver = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isInternalFileDrag(event) ? "move" : "copy";
    if (dragOverFolderId !== folder.id) {
      setDragOverFolderId(folder.id);
    }
  };

  const handleExternalDragLeave = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    if (dragOverFolderId === folder.id) {
      setDragOverFolderId(null);
    }
  };

  const handleExternalDrop = async (event: React.DragEvent) => {
    if (!isExternalFileDrag(event) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    if (isInternalFileDrag(event)) {
      const fileIds = getDraggedFileIds(event);
      console.log("[FolderTree] internal drop", {
        folderId: folder.id,
        fileIds,
        currentDragSessionId: useSelectionStore.getState().currentDragSessionId,
      });

      if (!useSelectionStore.getState().markInternalDropHandled()) {
        return;
      }

      if (fileIds.length > 1) {
        await useLibraryQueryStore.getState().moveFiles(fileIds, folder.id);
      } else if (fileIds.length === 1) {
        await useLibraryQueryStore.getState().moveFile(fileIds[0], folder.id);
      }

      useSelectionStore.getState().clearInternalFileDrag();
      setDragOverFolderId(null);
      return;
    }

    setDragOverFolderId(folder.id);
  };

  const isNestingTarget =
    dragPosition.type === "nest" && dragPosition.folderId === folder.id && !isBeingDragged;
  const showInsertLineBefore =
    dragPosition.type === "sort" &&
    dragPosition.targetId === folder.id &&
    !isBeingDragged &&
    dragPosition.before;
  const showInsertLineAfter =
    dragPosition.type === "sort" &&
    dragPosition.targetId === folder.id &&
    !isBeingDragged &&
    !dragPosition.before;

  return (
    <div className="folder-item-wrapper" data-folder-id={folder.id}>
      {showInsertLineBefore && canDrag && (
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
              draggableRef.current = element;
              registerKeyboardItem(folder.id, element);
            }}
            data-folder-id={folder.id}
            className={`${appTreeRowClass} ${
              isBeingDragged ? "opacity-50" : canDrag ? "cursor-pointer" : "cursor-default"
            } ${
              isSelected
                ? "bg-primary-100 dark:bg-primary-900/30"
                : isExternalDragTarget
                  ? "bg-emerald-100 dark:bg-emerald-900/30 ring-2 ring-emerald-400 dark:ring-emerald-600"
                  : isNestingTarget
                    ? "bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-400 dark:ring-blue-600"
                    : "hover:bg-gray-100 dark:hover:bg-dark-border"
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => {
              focusTree();
              void onSelectFolder(folder.id);
            }}
            onDragEnter={handleExternalDragEnter}
            onDragOver={handleExternalDragOver}
            onDragLeave={handleExternalDragLeave}
            onDrop={handleExternalDrop}
          >
            {hasChildren ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolder(folder.id);
                }}
              >
                <ChevronRight
                  className={`h-3 w-3 text-gray-500 transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              </Button>
            ) : (
              <span className="w-5" />
            )}

            {folder.name === "浏览器采集" || folder.isSystem ? (
              <Globe className="h-4 w-4 flex-shrink-0 text-blue-500" />
            ) : (
              <FolderIcon className="h-4 w-4 flex-shrink-0 text-yellow-500" />
            )}

            <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{folder.name}</span>

            {folder.fileCount > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{folder.fileCount}</span>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onSelect={handleShowInExplorer}>
            <FolderOpen className="mr-2 h-4 w-4" />
            显示在资源管理器
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleAddSubfolder}>
            <Plus className="mr-2 h-4 w-4" />
            创建子文件夹
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleRename}>
            <Pencil className="mr-2 h-4 w-4" />
            重命名
          </ContextMenuItem>
          {!isSystemFolder && (
            <ContextMenuItem disabled={!canMoveUp} onSelect={() => moveFolderByStep(-1)}>
              上移
            </ContextMenuItem>
          )}
          {!isSystemFolder && (
            <ContextMenuItem disabled={!canMoveDown} onSelect={() => moveFolderByStep(1)}>
              下移
            </ContextMenuItem>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="mr-2 h-4 w-4" />
              移动到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {menuItems.map((target) => (
                <ContextMenuItem
                  key={target.id === null ? "root" : target.id}
                  onSelect={() => moveFolder(folder.id, target.id)}
                  style={{
                    paddingLeft: `${(target.sortOrder === -1 ? 0 : target.sortOrder) * 12 + 8}px`,
                  }}
                >
                  {target.sortOrder === -1 ? `📁 ${target.name}` : target.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDelete} className="text-red-600">
            <Trash2 className="mr-2 h-4 w-4" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-1">
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              dragPosition={dragPosition}
              activeId={activeId}
              onDragPositionChange={onDragPositionChange}
              focusTree={focusTree}
              onSelectFolder={onSelectFolder}
              registerKeyboardItem={registerKeyboardItem}
              registerItem={registerItem}
            />
          ))}
        </div>
      )}

      {showInsertLineAfter && canDrag && (
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
