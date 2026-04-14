export type SettingsSection = "general" | "ai" | "shortcuts";

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
}

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "general", label: "通用" },
  { id: "ai", label: "AI" },
  { id: "shortcuts", label: "快捷键" },
];

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  return (
    <aside className="border-b border-gray-200 bg-gray-50/70 px-4 py-4 dark:border-dark-border dark:bg-dark-bg/40 md:w-52 md:border-b-0 md:border-r">
      <div className="flex gap-2 md:flex-col">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelectSection(section.id)}
            className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeSection === section.id
                ? "bg-white text-gray-900 shadow-sm dark:bg-dark-surface dark:text-gray-100"
                : "text-gray-500 hover:bg-white/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-dark-surface/70 dark:hover:text-gray-200"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
