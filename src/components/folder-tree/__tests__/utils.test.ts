import { describe, expect, it } from "vitest";
import { shouldResetQueryStateForSmartCollectionEntry } from "@/components/folder-tree/navigationState";

describe("folder tree navigation utils", () => {
  it("resets hidden query state when opening a smart collection from non-library views", () => {
    expect(
      shouldResetQueryStateForSmartCollectionEntry({
        currentView: "tags",
        smartCollection: "recent",
      }),
    ).toBe(true);
    expect(
      shouldResetQueryStateForSmartCollectionEntry({
        currentView: "trash",
        smartCollection: "untagged",
      }),
    ).toBe(true);
    expect(
      shouldResetQueryStateForSmartCollectionEntry({
        currentView: "library",
        smartCollection: "recent",
      }),
    ).toBe(false);
  });

  it("always resets query state when entering duplicate and similar view", () => {
    expect(
      shouldResetQueryStateForSmartCollectionEntry({
        currentView: "library",
        smartCollection: "similar",
      }),
    ).toBe(true);
  });
});
