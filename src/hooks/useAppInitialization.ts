import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";

export function useAppInitialization() {
  const { loadSettings } = useSettingsStore();
  const { loadTags } = useTagStore();
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) {
      return;
    }

    initRef.current = true;
    loadSettings();
    loadTags();
  }, [loadSettings, loadTags]);
}
