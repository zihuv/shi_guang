import { VIDEO_EXTENSIONS } from "../shared/file-extensions";

export const THUMBNAIL_PIXEL_THRESHOLD = 10_000_000;
export const THUMBNAIL_EDGE_THRESHOLD = 3840;
export const THUMBNAIL_SIZE_THRESHOLD = 8 * 1024 * 1024;

const VIDEO_EXTENSION_SET = new Set(VIDEO_EXTENSIONS);

export type ThumbnailDecisionReason =
  | "video"
  | "psd"
  | "pdf"
  | "pixel-threshold"
  | "edge-threshold"
  | "size-threshold"
  | "skip";

export interface ThumbnailDecisionInput {
  ext: string;
  width: number;
  height: number;
  size: number;
}

export interface ThumbnailDecision {
  shouldGenerate: boolean;
  reason: ThumbnailDecisionReason;
}

export function normalizeThumbnailExt(ext: string): string {
  return ext.trim().replace(/^\./, "").toLowerCase();
}

export function isVideoThumbnailExt(ext: string): boolean {
  return VIDEO_EXTENSION_SET.has(normalizeThumbnailExt(ext));
}

export function decideThumbnailGeneration(input: ThumbnailDecisionInput): ThumbnailDecision {
  const ext = normalizeThumbnailExt(input.ext);
  const width = Math.max(0, input.width);
  const height = Math.max(0, input.height);
  const size = Math.max(0, input.size);

  if (isVideoThumbnailExt(ext)) {
    return { shouldGenerate: true, reason: "video" };
  }

  if (ext === "psd") {
    return { shouldGenerate: true, reason: "psd" };
  }

  if (ext === "pdf") {
    return { shouldGenerate: true, reason: "pdf" };
  }

  if (width * height >= THUMBNAIL_PIXEL_THRESHOLD) {
    return { shouldGenerate: true, reason: "pixel-threshold" };
  }

  if (Math.max(width, height) >= THUMBNAIL_EDGE_THRESHOLD) {
    return { shouldGenerate: true, reason: "edge-threshold" };
  }

  if (size >= THUMBNAIL_SIZE_THRESHOLD) {
    return { shouldGenerate: true, reason: "size-threshold" };
  }

  return { shouldGenerate: false, reason: "skip" };
}
