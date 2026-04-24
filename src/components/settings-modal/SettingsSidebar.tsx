import { cn } from "@/lib/utils";
import { Keyboard, Settings, Sparkles } from "lucide-react";

export type SettingsSection = "general" | "ai" | "shortcuts";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
}

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
  { id: "general", label: "通用", icon: Settings },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
];

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  return (
    <aside className="border-b border-[var(--app-border)] px-3 pb-3 pt-1 md:w-44 md:border-b-0 md:border-r md:pt-2">
      <div className="flex gap-2 md:flex-col">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection(section.id)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium transition-colors",
                activeSection === section.id
                  ? "bg-black/[0.055] text-gray-900 dark:bg-white/[0.08] dark:text-gray-100"
                  : "text-gray-500 hover:bg-black/[0.035] hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200",
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
