import { describe, expect, it } from "vitest";
import { resolveLibraryQueryFolderId } from "@/stores/libraryQueryModel";

describe("libraryQueryModel", () => {
  it("ignores stale folder ids for global smart collections", () => {
    expect(
      resolveLibraryQueryFolderId({
        activeSmartCollection: "similar",
        selectedFolderId: 12,
        folderIdOverride: 12,
      }),
    ).toBeNull();
  });

  it("keeps folder scope for regular library queries", () => {
    expect(
      resolveLibraryQueryFolderId({
        activeSmartCollection: null,
        selectedFolderId: 12,
      }),
    ).toBe(12);
    expect(
      resolveLibraryQueryFolderId({
        activeSmartCollection: "all",
        selectedFolderId: 12,
        folderIdOverride: null,
      }),
    ).toBeNull();
  });
});
