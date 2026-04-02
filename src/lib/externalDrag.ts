import { invoke } from "@tauri-apps/api/core";

let activeDragPromise: Promise<void> | null = null;

export function startExternalFileDrag(fileIds: number[]) {
  const uniqueFileIds = Array.from(new Set(fileIds)).filter((fileId) =>
    Number.isFinite(fileId),
  );

  if (uniqueFileIds.length === 0) {
    return Promise.resolve();
  }

  if (activeDragPromise) {
    return activeDragPromise;
  }

  activeDragPromise = invoke<void>("start_drag_files", {
    fileIds: uniqueFileIds,
  }).finally(() => {
    activeDragPromise = null;
  });

  return activeDragPromise;
}
