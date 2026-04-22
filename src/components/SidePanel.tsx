import { appPanelClass, appPanelMetaClass, appTreeRowClass } from "@/lib/ui";
import { Box, Bookmark, Trash2 } from "lucide-react";
import FolderTree from "@/components/FolderTree";
import { selectFolderFromTree } from "@/components/folder-tree/utils";
import { useFolderStore } from "@/stores/folderStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTagStore } from "@/stores/tagStore";
import { useTrashStore } from "@/stores/trashStore";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  width: number;
}

export default function SidePanel({ width }: SidePanelProps) {
  const currentView = useNavigationStore((state) => state.currentView);
  const openTags = useNavigationStore((state) => state.openTags);
  const openTrash = useNavigationStore((state) => state.openTrash);
  const selectedFolderId = useFolderStore((state) => state.selectedFolderId);
  const tagCount = useTagStore((state) => state.flatTags.length);
  const trashCount = useTrashStore((state) => state.trashCount);

  const navItemClass = (active: boolean) =>
    cn(
      appTreeRowClass,
      "cursor-pointer",
      active
        ? "bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200"
        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-border",
    );

  return (
    <aside className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className="px-2.5 pb-1 pt-2.5">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={navItemClass(currentView === "library" && selectedFolderId === null)}
            onClick={() => void selectFolderFromTree(null)}
          >
            <Box className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 truncate text-left">全部素材</span>
          </button>

          <button
            type="button"
            className={navItemClass(currentView === "tags")}
            onClick={openTags}
          >
            <Bookmark className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 truncate text-left">标签管理</span>
            {tagCount > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{tagCount}</span>
            )}
          </button>

          <button
            type="button"
            className={navItemClass(currentView === "trash")}
            onClick={openTrash}
          >
            <Trash2 className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 truncate text-left">回收站</span>
            {trashCount > 0 && (
              <span className={`${appPanelMetaClass} tabular-nums`}>{trashCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto pt-1">
        <FolderTree showAllFilesRow={false} />
      </div>
    </aside>
  );
}
