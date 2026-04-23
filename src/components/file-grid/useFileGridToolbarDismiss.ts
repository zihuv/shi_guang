import { useEffect, type RefObject } from "react";
import { type ToolbarMenu } from "@/components/file-grid/FileGridChrome";

export function useFileGridToolbarDismiss({
  openToolbarMenu,
  isFilterPanelOpen,
  setOpenToolbarMenu,
  setFilterPanelOpen,
  scrollParentRef,
  filterMenuRef,
  filterMenuButtonRef,
  sortMenuRef,
  sortMenuButtonRef,
  layoutMenuRef,
  layoutMenuButtonRef,
  infoMenuRef,
  infoMenuButtonRef,
}: {
  openToolbarMenu: ToolbarMenu | null;
  isFilterPanelOpen: boolean;
  setOpenToolbarMenu: (menu: ToolbarMenu | null) => void;
  setFilterPanelOpen: (isOpen: boolean) => void;
  scrollParentRef: RefObject<HTMLDivElement | null>;
  filterMenuRef: RefObject<HTMLDivElement | null>;
  filterMenuButtonRef: RefObject<HTMLButtonElement | null>;
  sortMenuRef: RefObject<HTMLDivElement | null>;
  sortMenuButtonRef: RefObject<HTMLButtonElement | null>;
  layoutMenuRef: RefObject<HTMLDivElement | null>;
  layoutMenuButtonRef: RefObject<HTMLButtonElement | null>;
  infoMenuRef: RefObject<HTMLDivElement | null>;
  infoMenuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => {
    if (!openToolbarMenu && !isFilterPanelOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (
        filterMenuRef.current?.contains(target) ||
        filterMenuButtonRef.current?.contains(target) ||
        scrollParentRef.current?.contains(target)
      ) {
        return;
      }

      const activeMenuRef =
        openToolbarMenu === "sort"
          ? sortMenuRef
          : openToolbarMenu === "layout"
            ? layoutMenuRef
            : infoMenuRef;
      const activeButtonRef =
        openToolbarMenu === "sort"
          ? sortMenuButtonRef
          : openToolbarMenu === "layout"
            ? layoutMenuButtonRef
            : infoMenuButtonRef;

      if (activeMenuRef.current?.contains(target) || activeButtonRef.current?.contains(target)) {
        return;
      }

      if (openToolbarMenu) {
        setOpenToolbarMenu(null);
      }

      if (isFilterPanelOpen) {
        setFilterPanelOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openToolbarMenu) {
          setOpenToolbarMenu(null);
        }
        if (isFilterPanelOpen) {
          setFilterPanelOpen(false);
        }
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [
    filterMenuButtonRef,
    filterMenuRef,
    infoMenuButtonRef,
    infoMenuRef,
    isFilterPanelOpen,
    layoutMenuButtonRef,
    layoutMenuRef,
    openToolbarMenu,
    scrollParentRef,
    setFilterPanelOpen,
    setOpenToolbarMenu,
    sortMenuButtonRef,
    sortMenuRef,
  ]);
}
