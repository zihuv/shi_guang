import { describe, expect, it } from "vitest";
import { createThumbnailPathFallbackKey, resolveThumbnailCacheKey } from "../thumbnail";

describe("thumbnail cache keys", () => {
  it("uses content hash when available", () => {
    expect(
      resolveThumbnailCacheKey("/library/file.pdf", {
        contentHash: " content-hash ",
        size: 100,
        modifiedAt: "2026-04-29 10:00:00",
      }),
    ).toBe("content-hash");
  });

  it("changes the fallback key when un-hashed file metadata changes", () => {
    const first = resolveThumbnailCacheKey("/library/file.pdf", {
      contentHash: null,
      size: 100,
      modifiedAt: "2026-04-29 10:00:00",
    });
    const second = resolveThumbnailCacheKey("/library/file.pdf", {
      contentHash: null,
      size: 100,
      modifiedAt: "2026-04-29 10:01:00",
    });
    const third = resolveThumbnailCacheKey("/library/file.pdf", {
      contentHash: null,
      size: 101,
      modifiedAt: "2026-04-29 10:00:00",
    });

    expect(first).not.toBe(second);
    expect(first).not.toBe(third);
  });

  it("keeps the legacy path fallback when no file metadata is available", () => {
    expect(resolveThumbnailCacheKey("/library/file.pdf")).toBe(
      createThumbnailPathFallbackKey("/library/file.pdf"),
    );
  });
});
