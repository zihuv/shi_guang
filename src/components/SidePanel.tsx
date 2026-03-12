import { useEffect } from "react";
import FolderTree from "@/components/FolderTree"
import TagPanel from "@/components/TagPanel"
import { useFileStore } from "@/stores/fileStore";
import { useFolderStore } from "@/stores/folderStore";

export default function SidePanel() {
  const { loadFiles, loadFilesInFolder, setSelectedFolderId } = useFileStore();
  const { loadFolders, initDefaultFolder } = useFolderStore();

  useEffect(() => {
    // Load folders first, then init default folder
    const init = async () => {
      await loadFolders();
      const defaultFolder = await initDefaultFolder();
      if (defaultFolder) {
        setSelectedFolderId(defaultFolder.id);
        await loadFilesInFolder(defaultFolder.id);
      } else {
        await loadFiles();
      }
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
