import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DETAIL_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  clampDetailPanelWidth,
  clampSidebarWidth,
  useSettingsStore,
} from "@/stores/settingsStore";

const PANEL_RESIZER_TOTAL_WIDTH = 0;
const MIN_MAIN_PANEL_WIDTH = 240;
const MIN_RENDERED_SIDEBAR_WIDTH = 72;
const MIN_RENDERED_DETAIL_PANEL_WIDTH = 120;

type ResizeHandle = "sidebar" | "detail";

function clampDraggedWidth(value: number, minWidth: number, maxWidth: number) {
  const safeMaxWidth = Math.max(0, maxWidth);
  if (safeMaxWidth <= minWidth) {
    return safeMaxWidth;
  }

  return Math.max(minWidth, Math.min(safeMaxWidth, value));
}

function constrainPanelWidths(
  containerWidth: number,
  requestedSidebarWidth: number,
  requestedDetailPanelWidth: number,
) {
  let sidebarWidth = requestedSidebarWidth <= 0 ? 0 : clampSidebarWidth(requestedSidebarWidth);
  let detailPanelWidth =
    requestedDetailPanelWidth <= 0 ? 0 : clampDetailPanelWidth(requestedDetailPanelWidth);

  if (containerWidth <= 0) {
    return { sidebarWidth, detailPanelWidth };
  }

  const maxCombinedPanelWidth = Math.max(
    0,
    containerWidth - PANEL_RESIZER_TOTAL_WIDTH - MIN_MAIN_PANEL_WIDTH,
  );
  let overflow = sidebarWidth + detailPanelWidth - maxCombinedPanelWidth;

  if (overflow <= 0) {
    return { sidebarWidth, detailPanelWidth };
  }

  const detailPanelReducible = Math.max(0, detailPanelWidth - MIN_RENDERED_DETAIL_PANEL_WIDTH);
  const detailPanelReduction = Math.min(detailPanelReducible, overflow);
  detailPanelWidth -= detailPanelReduction;
  overflow -= detailPanelReduction;

  const sidebarReducible = Math.max(0, sidebarWidth - MIN_RENDERED_SIDEBAR_WIDTH);
  const sidebarReduction = Math.min(sidebarReducible, overflow);
  sidebarWidth -= sidebarReduction;
  overflow -= sidebarReduction;

  if (overflow > 0) {
    detailPanelWidth = Math.max(detailPanelWidth > 0 ? 48 : 0, detailPanelWidth - overflow);
  }

  return {
    sidebarWidth: sidebarWidth > 0 ? Math.max(48, Math.round(sidebarWidth)) : 0,
    detailPanelWidth: detailPanelWidth > 0 ? Math.max(48, Math.round(detailPanelWidth)) : 0,
  };
}

export function useAppPanelLayout({ showsDetailPanel }: { showsDetailPanel: boolean }) {
  const sidebarWidthPreference = useSettingsStore((state) => state.sidebarWidth);
  const detailPanelWidthPreference = useSettingsStore((state) => state.detailPanelWidth);
  const isSidebarCollapsed = useSettingsStore((state) => state.isSidebarCollapsed);
  const isDetailPanelCollapsed = useSettingsStore((state) => state.isDetailPanelCollapsed);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const setDetailPanelWidth = useSettingsStore((state) => state.setDetailPanelWidth);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const setDetailPanelCollapsed = useSettingsStore((state) => state.setDetailPanelCollapsed);
  const [contentWidth, setContentWidth] = useState(0);
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const activeResizeHandleRef = useRef<ResizeHandle | null>(null);

  const { sidebarWidth, detailPanelWidth } = constrainPanelWidths(
    contentWidth,
    isSidebarCollapsed ? 0 : sidebarWidthPreference,
    showsDetailPanel && !isDetailPanelCollapsed ? detailPanelWidthPreference : 0,
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  const detailPanelWidthRef = useRef(detailPanelWidth);

  sidebarWidthRef.current = sidebarWidth;
  detailPanelWidthRef.current = detailPanelWidth;

  useEffect(() => {
    const element = contentContainerRef.current;
    if (!element) {
      return undefined;
    }

    const updateContentWidth = () => {
      setContentWidth(element.clientWidth);
    };

    updateContentWidth();

    const observer = new ResizeObserver(() => {
      updateContentWidth();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const activeHandle = activeResizeHandleRef.current;
      const container = contentContainerRef.current;
      if (!activeHandle || !container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const nextContentWidth = rect.width;

      if (activeHandle === "sidebar") {
        const maxSidebarWidth = Math.min(
          MAX_SIDEBAR_WIDTH,
          nextContentWidth -
            detailPanelWidthRef.current -
            PANEL_RESIZER_TOTAL_WIDTH -
            MIN_MAIN_PANEL_WIDTH,
        );
        const nextSidebarWidth = clampDraggedWidth(
          event.clientX - rect.left,
          MIN_RENDERED_SIDEBAR_WIDTH,
          maxSidebarWidth,
        );
        setSidebarWidth(nextSidebarWidth);
        return;
      }

      const maxDetailWidth = Math.min(
        MAX_DETAIL_PANEL_WIDTH,
        nextContentWidth -
          sidebarWidthRef.current -
          PANEL_RESIZER_TOTAL_WIDTH -
          MIN_MAIN_PANEL_WIDTH,
      );
      const nextDetailWidth = clampDraggedWidth(
        rect.right - event.clientX,
        MIN_RENDERED_DETAIL_PANEL_WIDTH,
        maxDetailWidth,
      );
      setDetailPanelWidth(nextDetailWidth);
    };

    const stopResize = () => {
      if (!activeResizeHandleRef.current) {
        return;
      }

      activeResizeHandleRef.current = null;
      setActiveResizeHandle(null);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("blur", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("blur", stopResize);
      stopResize();
    };
  }, [setDetailPanelWidth, setSidebarWidth]);

  const handleResizeStart = useCallback((handle: ResizeHandle) => {
    return (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      activeResizeHandleRef.current = handle;
      setActiveResizeHandle(handle);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
  }, []);

  return {
    activeResizeHandle,
    contentContainerRef,
    detailPanelWidth,
    handleResizeStart,
    isDetailPanelCollapsed,
    isSidebarCollapsed,
    setDetailPanelCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
  };
}
