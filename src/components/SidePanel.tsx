import FolderTree from "@/components/FolderTree"
import TagPanel from "@/components/TagPanel"

interface SidePanelProps {
  width: number;
}

export default function SidePanel({ width }: SidePanelProps) {
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
