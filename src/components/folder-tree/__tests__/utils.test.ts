import { describe, expect, it } from "vitest";
import { shouldResetHiddenQueryStateForSmartCollection } from "@/components/folder-tree/navigationState";

describe("folder tree navigation utils", () => {
  it("resets hidden query state when opening a smart collection from non-library views", () => {
    expect(shouldResetHiddenQueryStateForSmartCollection("tags")).toBe(true);
    expect(shouldResetHiddenQueryStateForSmartCollection("trash")).toBe(true);
    expect(shouldResetHiddenQueryStateForSmartCollection("library")).toBe(false);
  });
});
