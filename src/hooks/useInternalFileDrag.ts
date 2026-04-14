import { useEffect } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

export function useInternalFileDrag(setDraggingFileId: (fileId: number | null) => void) {
  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (source.data.type === "app-file") {
          setDraggingFileId(source.data.fileId as number);
        }
      },
      onDrop: ({ source }) => {
        if (source.data.type === "app-file") {
          setDraggingFileId(null);
        }
      },
    });
  }, [setDraggingFileId]);
}
