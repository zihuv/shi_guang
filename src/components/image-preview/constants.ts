import type { FolderNode } from "@/stores/folderStore";
import { AI_SUPPORTED_IMAGE_EXTENSIONS, extensionSet } from "@/shared/file-formats";

export const AI_IMAGE_EXTENSIONS = extensionSet(AI_SUPPORTED_IMAGE_EXTENSIONS);

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 10000;
export const BUTTON_ZOOM_FACTOR = 1.2;
export const FIT_MODE_SNAP_EPSILON = 0.5;
export const BASE_WHEEL_ZOOM_SENSITIVITY = 0.002;
export const OVERLAY_BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
export const OVERLAY_CHIP_CLASS =
  "rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-white/70 backdrop-blur";
export const IS_MACOS = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function flattenFolders(nodes: FolderNode[], depth = 0): FolderNode[] {
  let result: FolderNode[] = [];
  for (const node of nodes) {
    result.push({ ...node, sortOrder: depth } as FolderNode);
    if (node.children && node.children.length > 0) {
      result = result.concat(flattenFolders(node.children, depth + 1));
    }
  }
  return result;
}
