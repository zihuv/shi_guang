import crypto from "node:crypto";

export const THUMBNAIL_CACHE_VERSION = "v4";
export const THUMBNAIL_MAX_EDGE = 768;
export const THUMBNAIL_WEBP_QUALITY = 85;
export const THUMBNAIL_PIXEL_THRESHOLD = 10_000_000;
export const THUMBNAIL_EDGE_THRESHOLD = 3840;
export const THUMBNAIL_SIZE_THRESHOLD = 8 * 1024 * 1024;

const VIDEO_EXTENSIONS = new Set(["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v", "3gp"]);

export type ThumbnailDecisionReason =
  | "video"
  | "psd"
  | "pdf"
  | "pixel-threshold"
  | "edge-threshold"
  | "size-threshold"
  | "skip";

export type ThumbnailStatus = "pending" | "ready" | "failed" | "skipped";

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
  return VIDEO_EXTENSIONS.has(normalizeThumbnailExt(ext));
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

export function createThumbnailPathFallbackKey(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(THUMBNAIL_CACHE_VERSION)
    .update("\0")
    .update(filePath)
    .digest("hex");
}

export function resolveThumbnailCacheKey(filePath: string, contentHash?: string | null): string {
  const normalizedContentHash = contentHash?.trim() ?? "";
  return normalizedContentHash || createThumbnailPathFallbackKey(filePath);
}
