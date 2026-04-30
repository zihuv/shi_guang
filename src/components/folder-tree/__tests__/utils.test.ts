import { describe, expect, it } from "vitest";
import { shouldResetQueryStateForSmartCollectionEntry } from "@/components/folder-tree/navigationState";
import {
  buildFolderMovePlan,
  getPersistedFolderIds,
  type FlattenedFolderNode,
} from "@/components/folder-tree/utils";

const makeFolder = (
  id: number,
  name: string,
  children: FlattenedFolderNode[] = [],
): FlattenedFolderNode => ({
  id,
  name,
  path: `/library/${name}`,
  children,
  fileCount: 0,
  sortOrder: 0,
});

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

  it("keeps browser collection in normal folder reorder plans", () => {
    const browserCollection = makeFolder(1, "浏览器采集");
    const folder = makeFolder(2, "测试");
    const target = makeFolder(3, "教程");

    expect(getPersistedFolderIds([browserCollection, folder, target])).toEqual([1, 2, 3]);
    expect(buildFolderMovePlan([browserCollection, folder, target], 3, null, 0)).toMatchObject({
      sourceSiblingIds: [1, 2],
      targetSiblingIds: [3, 1, 2],
      sortOrder: 0,
    });
  });
});
