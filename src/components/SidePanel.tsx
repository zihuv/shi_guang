import { useEffect } from "react";
import {
  Bookmark,
  Clock3,
  FolderX,
  Library,
  Shuffle,
  Tag,
  Trash2,
} from "lucide-react";
import { appPanelClass, appPanelMetaClass, appSectionLabelClass, appTreeRowClass } from "@/lib/ui";
import FolderTree from "@/components/FolderTree";
import { selectSmartCollectionFromSidebar } from "@/components/folder-tree/utils";
import { useFolderStore } from "@/stores/folderStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useSmartCollectionStore } from "@/stores/smartCollectionStore";
import { useTagStore } from "@/stores/tagStore";
import { useTrashStore } from "@/stores/trashStore";
import type { SmartCollectionId } from "@/stores/fileTypes";
import { cn } from "@/lib/utils";

interface SidePanelProps {
  width: number;
}

const SMART_COLLECTION_ITEMS: Array<{
  id: SmartCollectionId;
  label: string;
  icon: typeof Library;
}> = [
  { id: "all", label: "全部素材", icon: Library },
  { id: "unclassified", label: "未分类", icon: FolderX },
  { id: "untagged", label: "未标签", icon: Tag },
  { id: "recent", label: "最近使用", icon: Clock3 },
  { id: "random", label: "随机模式", icon: Shuffle },
];

export default function SidePanel({ width }: SidePanelProps) {
  const currentView = useNavigationStore((state) => state.currentView);
  const activeSmartCollection = useNavigationStore((state) => state.activeSmartCollection);
  const openTags = useNavigationStore((state) => state.openTags);
  const openTrash = useNavigationStore((state) => state.openTrash);
  const selectedFolderId = useFolderStore((state) => state.selectedFolderId);
  const tagCount = useTagStore((state) => state.flatTags.length);
  const trashCount = useTrashStore((state) => state.trashCount);
  const smartStats = useSmartCollectionStore((state) => state.stats);
  const loadSmartStats = useSmartCollectionStore((state) => state.loadStats);

  useEffect(() => {
    void loadSmartStats();
  }, [loadSmartStats]);

  const navItemClass = (active: boolean) =>
    cn(
      appTreeRowClass,
      "cursor-pointer",
      active
        ? "bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-200"
        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-border",
    );

  const getSmartCollectionCount = (smartCollection: SmartCollectionId) => {
    switch (smartCollection) {
      case "all":
        return smartStats.allCount;
      case "unclassified":
        return smartStats.unclassifiedCount;
      case "untagged":
        return smartStats.untaggedCount;
      default:
        return null;
    }
  };

  return (
    <aside className={`${appPanelClass} flex-shrink-0`} style={{ width }}>
      <div className="px-2.5 pb-1 pt-2.5">
        <div className="mb-2 px-2.5">
          <span className={appSectionLabelClass}>快捷视图</span>
        </div>

        <div className="flex flex-col gap-1">
          {SMART_COLLECTION_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = getSmartCollectionCount(item.id);
            const isActive =
              currentView === "library" &&
              ((item.id === "all" && selectedFolderId === null && activeSmartCollection === "all") ||
                activeSmartCollection === item.id);

            return (
              <button
                key={item.id}
                type="button"
                className={navItemClass(isActive)}
                onClick={() => void selectSmartCollectionFromSidebar(item.id)}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {typeof count === "number" && (
                  <span className={`${appPanelMetaClass} tabular-nums`}>{count}</span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            className={navItemClass(currentView === "tags")}
            onClick={openTags}
          >
            <Bookmark className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 truncate text-left">标签管理</span>
            {tagCount > 0 && <span className={`${appPanelMetaClass} tabular-nums`}>{tagCount}</span>}
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1">
        <div className="px-5 pb-1 pt-1">
          <span className={appSectionLabelClass}>文件夹</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FolderTree showAllFilesRow={false} showHeader={false} />
        </div>
      </div>
    </aside>
  );
}
