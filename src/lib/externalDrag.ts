import { startDragFiles } from "@/services/desktop/system";

let activeDragPromise: Promise<void> | null = null;
let activeDragFallbackTimer: number | null = null;

const EXTERNAL_DRAG_LOCK_TIMEOUT_MS = 15000;

function clearActiveDragLock() {
  activeDragPromise = null;
  if (activeDragFallbackTimer !== null) {
    window.clearTimeout(activeDragFallbackTimer);
    activeDragFallbackTimer = null;
  }
}

export function startExternalFileDrag(fileIds: number[]) {
  const uniqueFileIds = Array.from(new Set(fileIds)).filter((fileId) => Number.isFinite(fileId));

  if (uniqueFileIds.length === 0) {
    return Promise.resolve();
  }

  if (activeDragPromise) {
    return activeDragPromise;
  }

  activeDragPromise = startDragFiles(uniqueFileIds).finally(clearActiveDragLock);

  activeDragFallbackTimer = window.setTimeout(() => {
    clearActiveDragLock();
  }, EXTERNAL_DRAG_LOCK_TIMEOUT_MS);

  return activeDragPromise;
}
