import { useEffect, useRef, useState, type RefObject } from "react";

export function useFileGridViewportMetrics(
  scrollParentRef: RefObject<HTMLDivElement | null>,
  deps: { isLoading: boolean; filesLength: number },
) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollDirection, setScrollDirection] = useState<"forward" | "backward">("forward");
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const previousScrollTopRef = useRef(0);

  useEffect(() => {
    const element = scrollParentRef.current;
    if (!element) return;

    const updateWidth = () => {
      const styles = window.getComputedStyle(element);
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft || "0") +
        Number.parseFloat(styles.paddingRight || "0");
      const verticalPadding =
        Number.parseFloat(styles.paddingTop || "0") +
        Number.parseFloat(styles.paddingBottom || "0");

      setContainerWidth(Math.max(0, element.clientWidth - horizontalPadding));
      setViewportHeight(Math.max(0, element.clientHeight - verticalPadding));
      pendingScrollTopRef.current = element.scrollTop;
      setScrollTop(element.scrollTop);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    const handleScroll = () => {
      pendingScrollTopRef.current = element.scrollTop;
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const nextScrollTop = pendingScrollTopRef.current;
        if (nextScrollTop !== previousScrollTopRef.current) {
          setScrollDirection(nextScrollTop > previousScrollTopRef.current ? "forward" : "backward");
          previousScrollTopRef.current = nextScrollTop;
        }
        setScrollTop(nextScrollTop);
      });
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
      observer.disconnect();
      element.removeEventListener("scroll", handleScroll);
    };
  }, [deps.filesLength, deps.isLoading, scrollParentRef]);

  return {
    containerWidth,
    scrollTop,
    viewportHeight,
    scrollDirection,
  };
}
