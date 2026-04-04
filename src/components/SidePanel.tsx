import { useEffect, useRef } from "react";
import FolderTree from "@/components/FolderTree"
import TagPanel from "@/components/TagPanel"
import { useFileStore } from "@/stores/fileStore";
import { useFolderStore } from "@/stores/folderStore";

interface SidePanelProps {
  width: number;
}

export default function SidePanel({ width }: SidePanelProps) {
  const { loadFilesInFolder, setSelectedFolderId, loadTrashCount } = useFileStore();
  const { loadFolders, initDefaultFolder, folders, selectFolder } = useFolderStore();
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization
    if (initRef.current) return;
    initRef.current = true;

    // Load folders first, then init default folder
    const init = async () => {
      await loadFolders();
      await loadTrashCount();
      const defaultFolder = await initDefaultFolder();
      if (defaultFolder) {
        setSelectedFolderId(defaultFolder.id);
        await loadFilesInFolder(defaultFolder.id);
      } else if (folders.length > 0) {
        const firstUserFolder = folders.find((folder) => !folder.isSystem) ?? null;
        if (firstUserFolder) {
          selectFolder(firstUserFolder.id);
          await loadFilesInFolder(firstUserFolder.id);
        }
      }
      // If no folders at all, don't load any files
    };
    init();
  }, []);

  return (
    <aside
      className="flex-shrink-0 bg-white dark:bg-dark-surface flex flex-col overflow-hidden"
      style={{ width }}
    >
      <div className="flex-1 overflow-auto">
        <FolderTree />
      </div>
      <div className="border-t border-gray-200 dark:border-dark-border flex-1 overflow-auto">
        <TagPanel />
      </div>
    </aside>
  );
}
