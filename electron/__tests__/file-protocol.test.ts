import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

const { parseByteRange } = await import("../app/file-protocol");

describe("file protocol range support", () => {
  it("parses byte ranges for media seeking", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
    expect(parseByteRange("bytes=900-1200", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("rejects invalid or unsupported ranges", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("items=0-99", 1000)).toBeNull();
    expect(parseByteRange("bytes=200-100", 1000)).toBeNull();
    expect(parseByteRange("bytes=1000-", 1000)).toBeNull();
    expect(parseByteRange("bytes=0-1,4-5", 1000)).toBeNull();
    expect(parseByteRange("bytes=-0", 1000)).toBeNull();
  });
});
