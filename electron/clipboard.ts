import type { FileRecord } from "./types";

export const SHIGUANG_CLIPBOARD_FORMAT = "application/x-shiguang-image-items+json";

export interface ClipboardImportedImageItem {
  sourcePath: string;
  ext: string;
  rating: number;
  description: string;
  sourceUrl: string;
  tagIds: number[];
}

interface ClipboardPayload {
  version: 1;
  items: ClipboardImportedImageItem[];
}

export function serializeClipboardImportedImageItems(files: FileRecord[]): Buffer {
  const payload: ClipboardPayload = {
    version: 1,
    items: files.map((file) => ({
      sourcePath: file.path,
      ext: file.ext,
      rating: file.rating,
      description: file.description,
      sourceUrl: file.sourceUrl,
      tagIds: file.tags.map((tag) => tag.id),
    })),
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export function deserializeClipboardImportedImageItems(
  raw: Buffer,
): ClipboardImportedImageItem[] | null {
  if (!raw.length) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.toString("utf8")) as {
      version?: number;
      items?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      return null;
    }

    const items = parsed.items
      .map((item) => normalizeClipboardImportedImageItem(item))
      .filter((item): item is ClipboardImportedImageItem => Boolean(item));

    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function normalizeClipboardImportedImageItem(value: unknown): ClipboardImportedImageItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const sourcePath = String(item.sourcePath ?? "").trim();
  const ext = normalizeClipboardExt(item.ext);
  if (!sourcePath || !ext) {
    return null;
  }

  return {
    sourcePath,
    ext,
    rating: typeof item.rating === "number" ? item.rating : 0,
    description: typeof item.description === "string" ? item.description : "",
    sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
    tagIds: Array.isArray(item.tagIds)
      ? item.tagIds.filter((tagId): tagId is number => Number.isInteger(tagId))
      : [],
  };
}

function normalizeClipboardExt(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^\./, "")
    .toLowerCase();
}
