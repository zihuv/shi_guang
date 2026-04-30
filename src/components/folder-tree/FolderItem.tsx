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
  Move,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { appPanelMetaClass, appTreeRowClass } from "@/lib/ui";
import { showFolderInExplorer } from "@/services/desktop/system";
import { useFolderStore, type FolderNode } from "@/stores/folderStore";
import { useImportStore } from "@/stores/importStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useSelectionStore } from "@/stores/selectionStore";
import { getDroppedFilePaths, isExternalFileDrag } from "@/utils/dropImport";
import { Button } from "@/components/ui/Button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import {
  BROWSER_COLLECTION_FOLDER_NAME,
  BROWSER_COLLECTION_ICON_OPTIONS,
  getBrowserCollectionIconOption,
  isBrowserCollectionIconId,
} from "@/lib/browserCollectionIcons";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import type { DragPosition, RegisterTreeItem } from "./types";
import {
  INTERNAL_FILE_DRAG_MIME,
  buildFolderMovePlan,
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
  const importFiles = useImportStore((state) => state.importFiles);
  const { setAddingSubfolder, setEditingFolder, setDeleteConfirm } = useFolderStore();
  const browserCollectionIconId = useSettingsStore((state) => state.browserCollectionIconId);
  const setBrowserCollectionIconId = useSettingsStore((state) => state.setBrowserCollectionIconId);
  const isExpanded = expandedFolderIds.includes(folder.id);
  const isSelected = currentView === "library" && selectedFolderId === folder.id;
  const hasChildren = folder.children && folder.children.length > 0;
  const isBeingDragged = activeId === folder.id;
  const isExternalDragTarget = dragOverFolderId === folder.id;
  const folderRowPaddingLeft = depth * 12 + 8;
  const isBrowserCollectionFolder = folder.name === BROWSER_COLLECTION_FOLDER_NAME;
  const browserCollectionIcon = getBrowserCollectionIconOption(browserCollectionIconId);
  const BrowserCollectionIcon = browserCollectionIcon.Icon;

  const draggableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!draggableRef.current || !registerItem) return;
    return registerItem({ itemId: folder.id.toString(), element: draggableRef.current });
  }, [folder.id, registerItem]);

  const availableTargets = flattenFolders(folders).filter((target) => {
    if (target.id === folder.id) return false;
    if (isDescendant(folders, folder.id, target.id)) return false;
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
  const siblingFolders = findSiblings(folders, parentId);
  const siblingIndex = siblingFolders.findIndex((item) => item.id === folder.id);
  const canMoveUp = siblingIndex > 0;
  const canMoveDown = siblingIndex >= 0 && siblingIndex < siblingFolders.length - 1;

  useEffect(() => {
    const element = draggableRef.current;
    if (!element) return;

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
          const rect = element.getBoundingClientRect();
          const offsetY = input.clientY - rect.top;
          const edgeThreshold = Math.min(10, rect.height / 4);

          if (offsetY <= edgeThreshold || offsetY >= rect.height - edgeThreshold) {
            return attachClosestEdge(
              {
                ...data,
                dropIntent: "sort" as const,
              },
              {
                input,
                element,
                allowedEdges: ["top", "bottom"],
              },
            );
          }

          return {
            ...data,
            dropIntent: "nest" as const,
          };
        },
        canDrop: ({ source }) => {
          if (source.data.uniqueContextId !== uniqueContextId) {
            return false;
          }
          return source.data.type === "folder" && source.data.folderId !== folder.id;
        },
        onDrop: () => {},
      }),
    );
  }, [folder.id, folder.name, folders, hasChildren, onDragPositionChange, uniqueContextId]);

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
    const nextIndex = siblingIndex + step;
    if (siblingIndex < 0 || nextIndex < 0 || nextIndex >= siblingFolders.length) return;

    const reordered = [...siblingFolders];
    const [moved] = reordered.splice(siblingIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    await reorderFolders(reordered.map((item) => item.id));
  };

  const moveFolderToParent = async (newParentId: number | null) => {
    const plan = buildFolderMovePlan(folders, folder.id, newParentId);
    if (!plan) return;

    if (plan.currentParentId === newParentId) {
      return;
    }

    await moveFolder(folder.id, newParentId, {
      sortOrder: plan.sortOrder,
      sourceSiblingIds: plan.sourceSiblingIds,
      targetSiblingIds: plan.targetSiblingIds,
    });
  };

  const isInternalFileDrag = (event: React.DragEvent) => {
    if (Array.from(event.dataTransfer.types).includes(INTERNAL_FILE_DRAG_MIME)) {
      return true;
    }

    const { isDraggingInternal, draggedFileIds } = useSelectionStore.getState();
    return isDraggingInternal && draggedFileIds.length > 0;
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
    if (!isExternalFileDrag(event.dataTransfer) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(folder.id);
  };

  const handleExternalDragOver = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event.dataTransfer) && !isInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isInternalFileDrag(event) ? "move" : "copy";
    if (dragOverFolderId !== folder.id) {
      setDragOverFolderId(folder.id);
    }
  };

  const handleExternalDragLeave = (event: React.DragEvent) => {
    if (!isExternalFileDrag(event.dataTransfer) && !isInternalFileDrag(event)) return;
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
    if (!isExternalFileDrag(event.dataTransfer) && !isInternalFileDrag(event)) return;
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
    const paths = getDroppedFilePaths(event.dataTransfer);
    if (paths.length > 0) {
      await importFiles(paths, folder.id);
    }
    setDragOverFolderId(null);
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
      {showInsertLineBefore && (
        <div
          className="relative my-0.5 h-0.5 rounded-full bg-blue-500"
          style={{ marginLeft: `${folderRowPaddingLeft}px` }}
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
            className={cn(
              appTreeRowClass,
              "h-8 gap-1.5 pr-2 text-gray-700 outline-none dark:text-gray-300",
              isBeingDragged ? "opacity-50" : "cursor-pointer",
              isSelected
                ? "bg-black/[0.055] text-gray-900 ring-1 ring-inset ring-black/[0.045] dark:bg-white/[0.075] dark:text-gray-100 dark:ring-white/[0.06]"
                : isExternalDragTarget
                  ? "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-300 dark:bg-emerald-900/25 dark:text-emerald-100 dark:ring-emerald-600/80"
                  : isNestingTarget
                    ? "bg-primary-100 text-primary-900 ring-1 ring-inset ring-primary-300 dark:bg-primary-900/25 dark:text-primary-100 dark:ring-primary-600/80"
                    : "hover:bg-black/[0.04] dark:hover:bg-white/[0.055]",
            )}
            style={{ paddingLeft: `${folderRowPaddingLeft}px` }}
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
                className="h-5 w-5 flex-shrink-0 p-0"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolder(folder.id);
                }}
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 text-gray-400 transition-transform dark:text-gray-500 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              </Button>
            ) : (
              <span className="h-5 w-5 flex-shrink-0" />
            )}

            {isBrowserCollectionFolder ? (
              <BrowserCollectionIcon
                className={cn(
                  "h-[17px] w-[17px] flex-shrink-0",
                  browserCollectionIcon.iconClassName,
                )}
              />
            ) : (
              <FolderIcon
                className={cn(
                  "h-[17px] w-[17px] flex-shrink-0",
                  isSelected
                    ? "text-amber-500 dark:text-amber-300"
                    : "text-amber-500/90 dark:text-amber-400/90",
                )}
              />
            )}

            <span className="min-w-0 flex-1 truncate text-left font-medium">{folder.name}</span>

            {folder.fileCount > 0 && (
              <span
                className={cn(
                  appPanelMetaClass,
                  "ml-2 min-w-[1.5rem] text-right tabular-nums",
                  isSelected && "text-gray-600 dark:text-gray-300",
                )}
              >
                {folder.fileCount}
              </span>
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
          {isBrowserCollectionFolder && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <BrowserCollectionIcon
                  className={cn("mr-2 h-4 w-4", browserCollectionIcon.iconClassName)}
                />
                更换图标
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuRadioGroup
                  className="grid grid-cols-5 gap-1"
                  value={browserCollectionIconId}
                  onValueChange={(value) => {
                    if (!isBrowserCollectionIconId(value)) {
                      return;
                    }
                    void setBrowserCollectionIconId(value);
                  }}
                >
                  {BROWSER_COLLECTION_ICON_OPTIONS.map((option) => {
                    const Icon = option.Icon;
                    return (
                      <ContextMenuRadioItem
                        key={option.id}
                        value={option.id}
                        aria-label={option.label}
                        className="flex size-8 items-center justify-center rounded-md p-0 data-[state=checked]:bg-black/[0.07] dark:data-[state=checked]:bg-white/[0.1] [&>span:first-child]:hidden"
                      >
                        <Icon className={cn("h-4 w-4", option.iconClassName)} />
                      </ContextMenuRadioItem>
                    );
                  })}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem disabled={!canMoveUp} onSelect={() => moveFolderByStep(-1)}>
            上移
          </ContextMenuItem>
          <ContextMenuItem disabled={!canMoveDown} onSelect={() => moveFolderByStep(1)}>
            下移
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Move className="mr-2 h-4 w-4" />
              移动到
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {menuItems.map((target) => (
                <ContextMenuItem
                  key={target.id === null ? "root" : target.id}
                  onSelect={() => {
                    void moveFolderToParent(target.id);
                  }}
                  style={{
                    paddingLeft: `${(target.sortOrder === -1 ? 0 : target.sortOrder) * 12 + 8}px`,
                  }}
                >
                  {target.sortOrder === -1 ? (
                    <>
                      <FolderIcon className="mr-2 h-4 w-4 text-amber-500" />
                      {target.name}
                    </>
                  ) : (
                    target.name
                  )}
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
        <div className="flex flex-col gap-0.5">
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

      {showInsertLineAfter && (
        <div
          className="relative my-0.5 h-0.5 rounded-full bg-blue-500"
          style={{ marginLeft: `${folderRowPaddingLeft}px` }}
        >
          <div className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500" />
        </div>
      )}
    </div>
  );
}
