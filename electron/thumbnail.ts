import crypto from "node:crypto";

export {
  decideThumbnailGeneration,
  isVideoThumbnailExt,
  normalizeThumbnailExt,
  THUMBNAIL_EDGE_THRESHOLD,
  THUMBNAIL_PIXEL_THRESHOLD,
  THUMBNAIL_SIZE_THRESHOLD,
} from "../src/lib/thumbnailPolicy";
export type {
  ThumbnailDecision,
  ThumbnailDecisionInput,
  ThumbnailDecisionReason,
} from "../src/lib/thumbnailPolicy";

export const THUMBNAIL_CACHE_VERSION = "v4";
export const THUMBNAIL_MAX_EDGE = 768;
export const THUMBNAIL_WEBP_QUALITY = 85;
export type ThumbnailStatus = "pending" | "ready" | "failed" | "skipped";

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
