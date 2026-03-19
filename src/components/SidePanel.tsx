import { useEffect, useRef } from "react";
import FolderTree from "@/components/FolderTree"
import TagPanel from "@/components/TagPanel"
import { useFileStore } from "@/stores/fileStore";
import { useFolderStore } from "@/stores/folderStore";

export default function SidePanel() {
  const { loadFilesInFolder, setSelectedFolderId } = useFileStore();
  const { loadFolders, initDefaultFolder, folders, selectFolder } = useFolderStore();
  const initRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization
    if (initRef.current) return;
    initRef.current = true;

    // Load folders first, then init default folder
    const init = async () => {
      await loadFolders();
      const defaultFolder = await initDefaultFolder();
      if (defaultFolder) {
        setSelectedFolderId(defaultFolder.id);
        await loadFilesInFolder(defaultFolder.id);
      } else if (folders.length > 0) {
        // No default folder, but we have folders - select the first one
        selectFolder(folders[0].id);
        await loadFilesInFolder(folders[0].id);
      }
      // If no folders at all, don't load any files
    };
    init();
  }, []);

  return (
    <aside className="w-60 flex-shrink-0 bg-white dark:bg-dark-surface border-r border-gray-200 dark:border-dark-border flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <FolderTree />
      </div>
      <div className="border-t border-gray-200 dark:border-dark-border flex-1 overflow-auto">
        <TagPanel />
      </div>
    </aside>
  );
}
