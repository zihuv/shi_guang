import { describe, expect, it } from "vitest";
import { shouldResetHiddenFiltersForSmartCollection } from "@/components/folder-tree/utils";

describe("folder tree navigation utils", () => {
  it("resets hidden filters when opening a smart collection from non-library views", () => {
    expect(shouldResetHiddenFiltersForSmartCollection("tags")).toBe(true);
    expect(shouldResetHiddenFiltersForSmartCollection("trash")).toBe(true);
    expect(shouldResetHiddenFiltersForSmartCollection("library")).toBe(false);
  });
});
