import { useEffect, useRef } from "react";
import { useFilterStore } from "@/stores/filterStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";

export function useAppInitialization() {
  const { loadPreferences } = useFilterStore();
  const { loadSettings } = useSettingsStore();
  const { loadTags } = useTagStore();
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) {
      return;
    }

    initRef.current = true;
    loadPreferences();
    loadSettings();
    loadTags();
  }, [loadPreferences, loadSettings, loadTags]);
}
