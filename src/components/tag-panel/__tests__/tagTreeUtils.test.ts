import { describe, expect, it } from "vitest";
import {
  filterTagTree,
  findTagById,
  findTagParentId,
  findTagSiblings,
  isDescendant,
} from "@/components/tag-panel/tagTreeUtils";
import { type Tag } from "@/stores/tagStore";

function tag(id: number, name: string, children: Tag[] = [], parentId: number | null = null): Tag {
  return {
    id,
    name,
    color: "#000000",
    count: 0,
    parentId,
    sortOrder: id,
    children,
  };
}

describe("tagTreeUtils", () => {
  const tags = [
    tag(1, "视觉", [tag(2, "照片", [tag(3, "旅行", [], 2)], 1), tag(4, "截图", [], 1)]),
    tag(5, "文档"),
  ];

  it("finds tags, parents, siblings, and descendant relationships", () => {
    expect(findTagById(tags, 3)?.name).toBe("旅行");
    expect(findTagParentId(tags, 3)).toBe(2);
    expect(findTagParentId(tags, 1)).toBeNull();
    expect(findTagSiblings(tags, 1).map((item) => item.id)).toEqual([2, 4]);
    expect(isDescendant(tags, 1, 3)).toBe(true);
    expect(isDescendant(tags, 2, 4)).toBe(false);
  });

  it("keeps matching ancestors when filtering nested tags", () => {
    expect(filterTagTree(tags, "旅行")).toEqual([
      {
        ...tags[0],
        children: [
          {
            ...tags[0].children[0],
            children: [tags[0].children[0].children[0]],
          },
        ],
      },
    ]);

    expect(filterTagTree(tags, "   ")).toBe(tags);
  });

  it("uses fuzzy matching for tag names", () => {
    const englishTags = [tag(10, "Music Player"), tag(11, "Design Pattern")];

    expect(filterTagTree(englishTags, "mpy").map((item) => item.name)).toEqual(["Music Player"]);
    expect(filterTagTree(englishTags, "dpn").map((item) => item.name)).toEqual(["Design Pattern"]);
  });
});
