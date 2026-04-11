import { appPanelClass } from "@/lib/ui"
import FolderTree from "@/components/FolderTree"
import TagPanel from "@/components/TagPanel"

interface SidePanelProps {
  width: number;
}

export default function SidePanel({ width }: SidePanelProps) {
  return (
    <aside
      className={`${appPanelClass} flex-shrink-0`}
      style={{ width }}
    >
      <div className="flex-1 overflow-auto">
        <FolderTree />
      </div>
      <div className="app-panel-divider border-t flex-1 overflow-auto">
        <TagPanel />
      </div>
    </aside>
  );
}
