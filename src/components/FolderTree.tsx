import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { Files, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  buildVisibleTreeItems,
  useTreeKeyboardNavigation,
} from "@/hooks/useTreeKeyboardNavigation";
import { requestFocusFirstFile } from "@/lib/libraryNavigation";
import { appIconButtonClass, appSectionLabelClass, appTreeRowClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useFolderStore, type FolderNode } from "@/stores/folderStore";
import { useLibraryQueryStore } from "@/stores/libraryQueryStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTrashStore } from "@/stores/trashStore";
import { Button } from "@/components/ui/Button";
import { FolderDialogs } from "@/components/folder-tree/FolderDialogs";
import { FolderItem } from "@/components/folder-tree/FolderItem";
import { createTreeItemRegistry, type DragPosition } from "@/components/folder-tree/types";
import {
  buildFolderMovePlan,
  findFolderParentId,
  findSiblings,
  getAllFolderIds,
  getPersistedFolderIds,
  isDescendant,
  selectFolderFromTree,
} from "@/components/folder-tree/utils";

function replaceFolderChildren(
  items: FolderNode[],
  parentId: number,
  nextChildren: FolderNode[],
): FolderNode[] {
  return items.map((item) => {
    if (item.id === parentId) {
      return { ...item, children: nextChildren };
    }
    if (item.children && item.children.length > 0) {
      return { ...item, children: replaceFolderChildren(item.children, parentId, nextChildren) };
    }
    return item;
  });
}

function findFolderById(items: FolderNode[], targetId: number): FolderNode | null {
  for (const item of items) {
    if (item.id === targetId) {
      return item;
    }
    const nested = findFolderById(item.children, targetId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function pathHasPrefix(candidate: string, prefix: string) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedCandidate = normalize(candidate);
  const normalizedPrefix = normalize(prefix);
  return (
    normalizedCandidate === normalizedPrefix ||
    normalizedCandidate.startsWith(`${normalizedPrefix}/`)
  );
}

function reorderSiblings(
  siblings: FolderNode[],
  activeFolderId: number,
  targetId: number,
  insertBefore: boolean,
) {
  const activeIndex = siblings.findIndex((item) => item.id === activeFolderId);
  const targetIndex = siblings.findIndex((item) => item.id === targetId);

  if (activeIndex === -1 || targetIndex === -1) {
    return null;
  }

  let newIndex = targetIndex;
  if (!insertBefore && targetIndex < activeIndex) {
    newIndex = targetIndex + 1;
  } else if (insertBefore && targetIndex > activeIndex) {
    newIndex = targetIndex - 1;
  }

  if (newIndex === activeIndex) {
    return null;
  }

  const nextSiblings = [...siblings];
  const [movedFolder] = nextSiblings.splice(activeIndex, 1);
  nextSiblings.splice(newIndex, 0, movedFolder);
  return nextSiblings;
}

interface FolderTreeProps {
  showHeader?: boolean;
  showAllFilesRow?: boolean;
}

export default function FolderTree({ showHeader = true, showAllFilesRow = true }: FolderTreeProps) {
  const {
    folders,
    selectedFolderId,
    expandedFolderIds,
    isLoading,
    createFolder,
    deleteFolder,
    selectFolder,
    setNewFolderName,
    newFolderName,
    reorderFolders,
    moveFolder,
    setFolders,
    uniqueContextId,
  } = useFolderStore();
  const addingSubfolder = useFolderStore((state) => state.addingSubfolder);
  const editingFolder = useFolderStore((state) => state.editingFolder);
  const deleteConfirm = useFolderStore((state) => state.deleteConfirm);
  const setAddingSubfolder = useFolderStore((state) => state.setAddingSubfolder);
  const setEditingFolder = useFolderStore((state) => state.setEditingFolder);
  const setDeleteConfirm = useFolderStore((state) => state.setDeleteConfirm);
  const loadFilesInFolder = useLibraryQueryStore((state) => state.loadFilesInFolder);
  const currentView = useNavigationStore((state) => state.currentView);

  const [isAdding, setIsAdding] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<DragPosition>({ type: "none" });

  const dragPositionRef = useRef<DragPosition>({ type: "none" });
  const mouseYRef = useRef(0);

  useEffect(() => {
    dragPositionRef.current = dragPosition;
  }, [dragPosition]);

  const visibleFolderItems = useMemo(
    () => [
      {
        id: null,
        parentId: null,
        depth: 0,
        hasChildren: false,
        isExpanded: false,
      },
      ...buildVisibleTreeItems(folders, {
        expandedIds: expandedFolderIds,
        getId: (folder) => folder.id,
        getChildren: (folder) => folder.children,
      }),
    ],
    [expandedFolderIds, folders],
  );

  const {
    containerRef: treeContainerRef,
    focusContainer: focusTree,
    registerItem: registerKeyboardItem,
    handleKeyDown: handleTreeKeyDown,
  } = useTreeKeyboardNavigation({
    items: visibleFolderItems,
    selectedId: selectedFolderId,
    onSelect: async (folderId) => {
      focusTree();
      await selectFolderFromTree(folderId);
    },
    onToggle: (folderId) => {
      useFolderStore.getState().toggleFolder(folderId);
    },
    onActivate: requestFocusFirstFile,
  });

  const [registryState] = useState(createTreeItemRegistry);
  const { registry, registerTreeItem } = registryState;

  useEffect(() => {
    const container = document.getElementById("folder-tree-container");
    if (!container) return;

    const handleDragStart = (event: Event) => {
      const customEvent = event as CustomEvent<{ folderId: number }>;
      setActiveId(customEvent.detail.folderId);
    };

    const handleDragEnd = () => {
      setActiveId(null);
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouseYRef.current = event.clientY;
    };

    document.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("folder-drag-start", handleDragStart);
    container.addEventListener("folder-drag-end", handleDragEnd);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("folder-drag-start", handleDragStart);
      container.removeEventListener("folder-drag-end", handleDragEnd);
    };
  }, []);

  const applySortDrop = useCallback(
    (activeFolderId: number, targetId: number, insertBefore: boolean) => {
      if (isDescendant(folders, activeFolderId, targetId)) {
        console.log("Cannot drag parent into its own child (circular reference)");
        return;
      }

      const activeParentId = findFolderParentId(folders, activeFolderId, null);
      const targetParentId = findFolderParentId(folders, targetId, null);

      if (activeParentId !== targetParentId) {
        const targetSiblings = findSiblings(folders, targetParentId).filter(
          (item) => item.id !== activeFolderId,
        );
        const targetIndex = targetSiblings.findIndex((item) => item.id === targetId);
        if (targetIndex === -1) {
          return;
        }

        const plan = buildFolderMovePlan(
          folders,
          activeFolderId,
          targetParentId,
          insertBefore ? targetIndex : targetIndex + 1,
        );
        if (!plan) {
          return;
        }

        void moveFolder(activeFolderId, targetParentId, {
          sortOrder: plan.sortOrder,
          sourceSiblingIds: plan.sourceSiblingIds,
          targetSiblingIds: plan.targetSiblingIds,
        });
        return;
      }

      const siblings = findSiblings(folders, activeParentId);
      const reorderedSiblings = reorderSiblings(siblings, activeFolderId, targetId, insertBefore);
      if (!reorderedSiblings) {
        return;
      }

      if (activeParentId === null) {
        setFolders(reorderedSiblings);
      } else {
        setFolders(replaceFolderChildren(folders, activeParentId, reorderedSiblings));
      }

      const folderIds = getPersistedFolderIds(reorderedSiblings);
      if (folderIds.length > 0) {
        void reorderFolders(folderIds);
      }
    },
    [folders, moveFolder, reorderFolders, setFolders],
  );

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) =>
        source.data.uniqueContextId === uniqueContextId && source.data.type === "folder",
      onDragStart: ({ source }) => {
        if (source.data.type === "folder") {
          setActiveId(source.data.folderId as number);
        }
      },
      onDrag: ({ source, location }) => {
        const dropTargets = location.current.dropTargets;

        if (dropTargets.length === 0) {
          const allIds = getAllFolderIds(folders);
          let closestFolder: { id: number; element: HTMLElement } | null = null;
          let minDistance = Infinity;

          for (const id of allIds) {
            const item = registry.get(id.toString());
            if (!item?.element) continue;
            const rect = item.element.getBoundingClientRect();
            const folderCenterY = rect.top + rect.height / 2;
            const distance = Math.abs(mouseYRef.current - folderCenterY);
            if (distance < minDistance) {
              minDistance = distance;
              closestFolder = { id, element: item.element };
            }
          }

          if (closestFolder && minDistance < 100) {
            const rect = closestFolder.element.getBoundingClientRect();
            setDragPosition({
              type: "sort",
              targetId: closestFolder.id,
              before: mouseYRef.current < rect.top + rect.height / 2,
            });
          } else {
            setDragPosition({ type: "none" });
          }
          return;
        }

        const targetData = dropTargets[0].data;
        if (targetData.type === "folder") {
          const targetFolderId = targetData.folderId as number;
          const sourceFolderId = source.data.folderId as number;
          if (targetData.dropIntent === "nest") {
            if (
              sourceFolderId !== targetFolderId &&
              !isDescendant(folders, sourceFolderId, targetFolderId)
            ) {
              setDragPosition({ type: "nest", folderId: targetFolderId });
              return;
            }
          }

          const closestEdge = extractClosestEdge(targetData);
          if (closestEdge) {
            setDragPosition({
              type: "sort",
              targetId: targetFolderId,
              before: closestEdge === "top",
            });
            return;
          }
        }

        setDragPosition({ type: "none" });
      },
      onDrop: ({ source, location }) => {
        if (source.data.type !== "folder") {
          setDragPosition({ type: "none" });
          setActiveId(null);
          return;
        }

        const activeFolderId = source.data.folderId as number;
        const savedDragPosition = dragPositionRef.current;
        const dropTargets = location.current.dropTargets;

        if (dropTargets.length === 0) {
          if (savedDragPosition.type === "sort") {
            applySortDrop(activeFolderId, savedDragPosition.targetId, savedDragPosition.before);
          }
          setDragPosition({ type: "none" });
          setActiveId(null);
          return;
        }

        const targetData = dropTargets[0].data;

        if (targetData.type === "folder") {
          const targetFolderId = targetData.folderId as number;
          if (targetData.dropIntent === "nest") {
            if (
              activeFolderId !== targetFolderId &&
              !isDescendant(folders, activeFolderId, targetFolderId)
            ) {
              const plan = buildFolderMovePlan(folders, activeFolderId, targetFolderId);
              if (plan) {
                void moveFolder(activeFolderId, targetFolderId, {
                  sortOrder: plan.sortOrder,
                  sourceSiblingIds: plan.sourceSiblingIds,
                  targetSiblingIds: plan.targetSiblingIds,
                });
              }
            }

            setDragPosition({ type: "none" });
            setActiveId(null);
            return;
          }

          const closestEdge = extractClosestEdge(targetData);
          if (closestEdge && targetFolderId !== activeFolderId) {
            applySortDrop(activeFolderId, targetFolderId, closestEdge === "top");
          }
        }

        setDragPosition({ type: "none" });
        setActiveId(null);
      },
    });
  }, [applySortDrop, folders, moveFolder, registry, uniqueContextId]);

  const selectFolderForKeyboard = async (folderId: number | null) => {
    focusTree();
    await selectFolderFromTree(folderId);
  };

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const createdFolder = await createFolder(newFolderName.trim(), null);
      setNewFolderName("");
      setIsAdding(false);
      selectFolder(createdFolder.id);
      await loadFilesInFolder(createdFolder.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAddSubfolderSubmit = async () => {
    if (!newFolderName.trim() || !addingSubfolder) return;
    await createFolder(newFolderName.trim(), addingSubfolder.id);
    setNewFolderName("");
    setAddingSubfolder(null);
  };

  const handleRenameSubmit = async () => {
    if (!editingFolder || !newFolderName.trim()) return;
    await useFolderStore.getState().renameFolder(editingFolder.id, newFolderName.trim());
    setEditingFolder(null);
    setNewFolderName("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;

    const deletedId = deleteConfirm.id;
    const selectedFolder =
      selectedFolderId !== null ? findFolderById(folders, selectedFolderId) : null;
    const shouldSelectOnUndo = Boolean(
      selectedFolder && pathHasPrefix(selectedFolder.path, deleteConfirm.path),
    );
    setDeleteConfirm(null);

    const result = await deleteFolder(deletedId);
    if (!result) {
      return;
    }

    if (result.movedToTrash) {
      await useTrashStore.getState().addFolderDeleteToUndoStack({
        folderId: result.folderId,
        folderName: result.folderName,
        folderPath: result.folderPath,
        shouldSelectOnUndo,
      });
      toast.success(`已删除文件夹“${result.folderName}”，可在回收站恢复或按 Cmd/Ctrl+Z 撤回。`);
    } else {
      toast.success(`已删除文件夹“${result.folderName}”。`);
    }
  };

  return (
    <div className="flex flex-col">
      {showHeader && (
        <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
          <h2 className={cn(appSectionLabelClass, "mb-0")}>文件夹</h2>
          <Button
            variant="ghost"
            size="icon"
            className={cn(appIconButtonClass, "size-7 rounded-lg")}
            onClick={() => setIsAdding(true)}
            title="在当前素材库根目录创建文件夹"
            aria-label="创建文件夹"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        id="folder-tree-container"
        ref={treeContainerRef}
        className="relative flex-1 overflow-auto px-2.5 pb-2 pt-0 focus:outline-none"
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
      >
        {isLoading && folders.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {showAllFilesRow && (
              <div
                ref={(element) => registerKeyboardItem(null, element)}
                className={cn(
                  appTreeRowClass,
                  "h-8 cursor-pointer gap-1.5 pr-2 text-gray-700 dark:text-gray-300",
                  currentView === "library" && selectedFolderId === null
                    ? "bg-black/[0.055] text-gray-900 ring-1 ring-inset ring-black/[0.045] dark:bg-white/[0.075] dark:text-gray-100 dark:ring-white/[0.06]"
                    : "hover:bg-black/[0.04] dark:hover:bg-white/[0.055]",
                )}
                style={{ paddingLeft: "8px" }}
                onClick={() => {
                  focusTree();
                  void selectFolderForKeyboard(null);
                }}
              >
                <span className="w-5" />
                <Files className="h-4 w-4 flex-shrink-0 text-gray-500" />
                <span className="flex-1 truncate text-gray-700 dark:text-gray-300">全部文件</span>
              </div>
            )}

            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                depth={0}
                dragPosition={dragPosition}
                activeId={activeId}
                onDragPositionChange={setDragPosition}
                focusTree={focusTree}
                onSelectFolder={selectFolderForKeyboard}
                registerKeyboardItem={registerKeyboardItem}
                registerItem={registerTreeItem}
              />
            ))}

            {folders.length === 0 && (
              <div className="py-4 text-center text-[12px] text-gray-400 dark:text-gray-500">
                暂无文件夹
              </div>
            )}
          </div>
        )}
      </div>

      <FolderDialogs
        isAdding={isAdding}
        setIsAdding={setIsAdding}
        onAddFolder={handleAddFolder}
        onAddSubfolderSubmit={handleAddSubfolderSubmit}
        onRenameSubmit={handleRenameSubmit}
        onConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
}
