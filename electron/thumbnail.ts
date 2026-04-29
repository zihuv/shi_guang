import crypto from "node:crypto";

export {
  decideThumbnailGeneration,
  decideThumbnailPlan,
  getThumbnailGenerationRuntimeForExt,
  isMainProcessThumbnailExt,
  isThumbnailSupportedExt,
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
  ThumbnailGenerationRuntime,
  ThumbnailPlan,
} from "../src/lib/thumbnailPolicy";

export const THUMBNAIL_CACHE_VERSION = "v4";
export const THUMBNAIL_MAX_EDGE = 768;
export const THUMBNAIL_WEBP_QUALITY = 85;
export type ThumbnailStatus = "pending" | "ready" | "failed" | "skipped";

export interface ThumbnailCacheIdentity {
  contentHash?: string | null;
  size?: number | null;
  modifiedAt?: string | null;
}

export function createThumbnailPathFallbackKey(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(THUMBNAIL_CACHE_VERSION)
    .update("\0")
    .update(filePath)
    .digest("hex");
}

export function createThumbnailVersionedFallbackKey(
  filePath: string,
  size: number,
  modifiedAt: string,
): string {
  return crypto
    .createHash("sha256")
    .update(THUMBNAIL_CACHE_VERSION)
    .update("\0")
    .update(filePath)
    .update("\0")
    .update(String(size))
    .update("\0")
    .update(modifiedAt)
    .digest("hex");
}

export function resolveThumbnailCacheKey(
  filePath: string,
  identity?: ThumbnailCacheIdentity | string | null,
): string {
  const normalizedContentHash =
    typeof identity === "string" ? identity.trim() : (identity?.contentHash?.trim() ?? "");
  if (normalizedContentHash) {
    return normalizedContentHash;
  }

  const size = typeof identity === "object" ? identity?.size : null;
  const modifiedAt = typeof identity === "object" ? (identity?.modifiedAt?.trim() ?? "") : "";
  if (typeof size === "number" && Number.isFinite(size) && modifiedAt) {
    return createThumbnailVersionedFallbackKey(filePath, size, modifiedAt);
  }

  return normalizedContentHash || createThumbnailPathFallbackKey(filePath);
}
