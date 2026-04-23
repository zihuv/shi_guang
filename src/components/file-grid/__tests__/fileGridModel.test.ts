import { describe, expect, it } from "vitest";
import {
  getCurrentSortDirectionLabel,
  getCurrentSortFieldLabel,
  getCurrentViewModeLabel,
  getNextFileGridIndex,
  getPrewarmCandidates,
  getVisibleInfoFieldLabels,
} from "@/components/file-grid/fileGridModel";
import { type AdaptiveLayoutItem } from "@/components/file-grid/fileGridLayout";
import { type FileItem } from "@/stores/fileTypes";

function createFile(id: number): FileItem {
  return {
    id,
    path: `/library/${id}.png`,
    name: `${id}.png`,
    ext: "png",
    size: 1000 + id,
    width: 100,
    height: 80,
    folderId: 1,
    createdAt: "2026-04-23 10:00:00",
    modifiedAt: "2026-04-23 10:00:00",
    importedAt: "2026-04-23 10:00:00",
    lastAccessedAt: null,
    rating: 0,
    description: "",
    sourceUrl: "",
    dominantColor: "#000000",
    colorDistribution: [],
    thumbHash: "",
    tags: [],
  };
}

describe("fileGridModel", () => {
  it("builds toolbar labels from the active sort and view state", () => {
    expect(getCurrentSortFieldLabel("size", null)).toBe("文件大小");
    expect(getCurrentSortFieldLabel("created_at", "random")).toBe("随机模式");
    expect(getCurrentSortDirectionLabel("asc", "recent")).toBe("固定排序");
    expect(getCurrentSortDirectionLabel("desc", null)).toBe("降序");
    expect(getCurrentViewModeLabel("adaptive")).toBe("自适应");
    expect(getVisibleInfoFieldLabels(["name", "tags", "size"])).toEqual([
      "名称",
      "标签",
      "文件大小",
    ]);
  });

  it("derives prewarm candidates from the visible window and scroll direction", () => {
    const files = Array.from({ length: 8 }, (_, index) => createFile(index + 1));

    expect(
      getPrewarmCandidates({
        filteredFiles: files,
        viewMode: "grid",
        adaptiveVisibleItems: [],
        gridVirtualRows: [0, 1],
        gridColumns: 2,
        listVirtualIndexes: [],
        scrollDirection: "forward",
      }).map((file) => file.id),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    expect(
      getPrewarmCandidates({
        filteredFiles: files,
        viewMode: "list",
        adaptiveVisibleItems: [],
        gridVirtualRows: [],
        gridColumns: 2,
        listVirtualIndexes: [4, 5],
        scrollDirection: "backward",
      }).map((file) => file.id),
    ).toEqual([5, 6, 1, 2, 3, 4]);

    expect(
      getPrewarmCandidates({
        filteredFiles: files,
        viewMode: "adaptive",
        adaptiveVisibleItems: [
          { file: files[2], index: 2 },
          { file: files[3], index: 3 },
        ],
        gridVirtualRows: [],
        gridColumns: 2,
        listVirtualIndexes: [],
        scrollDirection: "forward",
      }).map((file) => file.id),
    ).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("computes the next keyboard navigation target across view modes", () => {
    const adaptiveItems: AdaptiveLayoutItem[] = [
      { file: createFile(1), index: 0, columnIndex: 0, left: 0, top: 0, width: 100, height: 100 },
      {
        file: createFile(2),
        index: 1,
        columnIndex: 1,
        left: 120,
        top: 0,
        width: 100,
        height: 100,
      },
      {
        file: createFile(3),
        index: 2,
        columnIndex: 0,
        left: 0,
        top: 120,
        width: 100,
        height: 100,
      },
    ];

    expect(
      getNextFileGridIndex({
        currentIndex: -1,
        key: "ArrowRight",
        filteredFilesLength: 5,
        viewMode: "grid",
        gridColumns: 2,
        adaptiveItems,
      }),
    ).toBe(0);

    expect(
      getNextFileGridIndex({
        currentIndex: 3,
        key: "ArrowUp",
        filteredFilesLength: 6,
        viewMode: "grid",
        gridColumns: 3,
        adaptiveItems,
      }),
    ).toBe(0);

    expect(
      getNextFileGridIndex({
        currentIndex: 1,
        key: "ArrowDown",
        filteredFilesLength: 2,
        viewMode: "grid",
        gridColumns: 2,
        adaptiveItems,
      }),
    ).toBeNull();

    expect(
      getNextFileGridIndex({
        currentIndex: 2,
        key: "ArrowLeft",
        filteredFilesLength: 5,
        viewMode: "list",
        gridColumns: 1,
        adaptiveItems,
      }),
    ).toBe(1);

    expect(
      getNextFileGridIndex({
        currentIndex: 0,
        key: "ArrowRight",
        filteredFilesLength: 3,
        viewMode: "adaptive",
        gridColumns: 1,
        adaptiveItems,
      }),
    ).toBe(1);
  });
});
