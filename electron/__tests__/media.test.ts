import { describe, expect, it } from "vitest";
import {
  canAnalyzeImage,
  canBackendDecodeImage,
  detectExtensionFromBytes,
  isBlockedUnsupportedExtension,
  isScanSupportedExtension,
} from "../media";

describe("media format support", () => {
  it("supports lightweight image aliases and HEIC/HEIF paths", () => {
    expect(isScanSupportedExtension("jfif")).toBe(true);
    expect(isScanSupportedExtension("jpe")).toBe(true);
    expect(isScanSupportedExtension("heic")).toBe(true);
    expect(canBackendDecodeImage("heif")).toBe(true);
    expect(canAnalyzeImage("jfif")).toBe(true);
  });

  it("allows office, audio, archive, and additional video extensions for indexing", () => {
    for (const ext of [
      "docx",
      "xlsx",
      "pptx",
      "html",
      "mp3",
      "aiff",
      "zip",
      "rar",
      "3g2",
      "m2ts",
    ]) {
      expect(isScanSupportedExtension(ext)).toBe(true);
    }
  });

  it("keeps RAW and unsupported professional formats out of the lightweight path", () => {
    for (const ext of ["ai", "eps", "raw", "cr2", "cr3", "nef", "arw", "dng"]) {
      expect(isScanSupportedExtension(ext)).toBe(false);
      expect(isBlockedUnsupportedExtension(ext)).toBe(true);
    }
  });

  it("detects 3GPP2 separately from 3GPP brands", () => {
    const bytes = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x32, 0x61,
    ]);
    expect(detectExtensionFromBytes(bytes)).toBe("3g2");
  });

  it("falls back to the shared content type registry when signatures are inconclusive", () => {
    const empty = Buffer.alloc(0);

    expect(detectExtensionFromBytes(empty, "text/html; charset=utf-8")).toBe("html");
    expect(detectExtensionFromBytes(empty, "image/apng")).toBe("png");
    expect(detectExtensionFromBytes(empty, "image/jpg")).toBe("jpg");
    expect(detectExtensionFromBytes(empty, "application/vnd.rar")).toBe("rar");
    expect(detectExtensionFromBytes(empty, "application/x-rar-compressed")).toBe("rar");
    expect(detectExtensionFromBytes(empty, "application/octet-stream")).toBeNull();
  });
});
