import { useEffect } from "react";
import { Bookmark, Clock3, FolderX, Library, ScanSearch, Shuffle, Tag, Trash2 } from "lucide-react";
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
  { id: "similar", label: "重复/相似", icon: ScanSearch },
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
      "cursor-pointer gap-1 px-1.5",
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
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="px-2 pb-1 pt-2.5">
          <span className={cn(appSectionLabelClass, "mb-2 block")}>快捷视图</span>

          <div className="flex flex-col gap-1">
            {SMART_COLLECTION_ITEMS.map((item) => {
              const Icon = item.icon;
              const count = getSmartCollectionCount(item.id);
              const isActive =
                currentView === "library" &&
                ((item.id === "all" &&
                  selectedFolderId === null &&
                  activeSmartCollection === "all") ||
                  activeSmartCollection === item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={navItemClass(isActive)}
                  onClick={() => void selectSmartCollectionFromSidebar(item.id)}
                >
                  <span className="h-5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  <Icon className="h-[17px] w-[17px] flex-shrink-0" />
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
              <span className="h-5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <Bookmark className="h-[17px] w-[17px] flex-shrink-0" />
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
              <span className="h-5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <Trash2 className="h-[17px] w-[17px] flex-shrink-0" />
              <span className="flex-1 truncate text-left">回收站</span>
              {trashCount > 0 && (
                <span className={`${appPanelMetaClass} tabular-nums`}>{trashCount}</span>
              )}
            </button>
          </div>
        </div>

        <div className="pt-1">
          <FolderTree showAllFilesRow={false} showHeader />
        </div>
      </div>
    </aside>
  );
}
