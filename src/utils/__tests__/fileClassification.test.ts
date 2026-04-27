import { describe, expect, it } from "vitest";
import {
  canGenerateThumbnail,
  canPreviewFile,
  detectMimeTypeFromContents,
  getFileKind,
  getFileMimeType,
  getFilePreviewMode,
  normalizeExt,
  resolveThumbnailRequestMaxEdge,
} from "@/utils/fileClassification";

describe("fileClassification", () => {
  it("normalizes extensions and classifies preview modes", () => {
    expect(normalizeExt(".PNG")).toBe("png");
    expect(getFilePreviewMode("jpg")).toBe("image");
    expect(getFilePreviewMode("jfif")).toBe("image");
    expect(getFilePreviewMode("heic")).toBe("thumbnail");
    expect(getFilePreviewMode("mp4")).toBe("video");
    expect(getFilePreviewMode("3g2")).toBe("video");
    expect(getFilePreviewMode("pdf")).toBe("thumbnail");
    expect(getFilePreviewMode("md")).toBe("text");
    expect(getFilePreviewMode("exe")).toBe("none");

    expect(canPreviewFile("csv")).toBe(true);
    expect(canPreviewFile("mp3")).toBe(false);
    expect(canGenerateThumbnail("psd")).toBe(true);
    expect(canGenerateThumbnail("heif")).toBe(true);
    expect(canGenerateThumbnail("txt")).toBe(false);
  });

  it("resolves file kind and mime type from extensions and signatures", () => {
    expect(getFileKind("xlsx")).toBe("spreadsheet");
    expect(getFileKind("mp3")).toBe("audio");
    expect(getFileKind("rar")).toBe("archive");
    expect(getFileKind("tsx")).toBe("code");
    expect(getFileKind("zip")).toBe("archive");
    expect(getFileMimeType("/tmp/photo.jpeg")).toBe("image/jpeg");
    expect(getFileMimeType("/tmp/live.heic")).toBe("image/heic");

    expect(detectMimeTypeFromContents(new Uint8Array([0xff, 0xd8, 0xff]), "fallback.bin")).toBe(
      "image/jpeg",
    );
    expect(
      detectMimeTypeFromContents(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        "fallback.bin",
      ),
    ).toBe("image/webp");
  });

  it("caps thumbnail request sizes to the supported cache variant", () => {
    expect(resolveThumbnailRequestMaxEdge(1)).toBe(768);
    expect(resolveThumbnailRequestMaxEdge(2000, 1200)).toBe(768);
  });
});
