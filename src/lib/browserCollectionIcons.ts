import {
  Archive,
  Bookmark,
  Camera,
  CloudDownload,
  Compass,
  Download,
  FolderDown,
  Globe2,
  Image,
  Inbox,
  Library,
  Search,
  Sparkles,
  SquareMousePointer,
  Telescope,
  type LucideIcon,
} from "lucide-react";

export const BROWSER_COLLECTION_FOLDER_NAME = "浏览器采集";

export const DEFAULT_BROWSER_COLLECTION_ICON_ID = "folder-down";

export type BrowserCollectionIconId =
  | "folder-down"
  | "globe"
  | "compass"
  | "cursor"
  | "download"
  | "cloud-download"
  | "image"
  | "camera"
  | "bookmark"
  | "inbox"
  | "archive"
  | "library"
  | "search"
  | "telescope"
  | "sparkles";

export interface BrowserCollectionIconOption {
  id: BrowserCollectionIconId;
  label: string;
  Icon: LucideIcon;
  iconClassName: string;
}

export const BROWSER_COLLECTION_ICON_OPTIONS: BrowserCollectionIconOption[] = [
  {
    id: "folder-down",
    label: "默认收集",
    Icon: FolderDown,
    iconClassName: "text-amber-500 dark:text-amber-300",
  },
  {
    id: "globe",
    label: "网页",
    Icon: Globe2,
    iconClassName: "text-sky-500 dark:text-sky-300",
  },
  {
    id: "compass",
    label: "探索",
    Icon: Compass,
    iconClassName: "text-indigo-500 dark:text-indigo-300",
  },
  {
    id: "cursor",
    label: "点击采集",
    Icon: SquareMousePointer,
    iconClassName: "text-violet-500 dark:text-violet-300",
  },
  {
    id: "download",
    label: "下载",
    Icon: Download,
    iconClassName: "text-emerald-500 dark:text-emerald-300",
  },
  {
    id: "cloud-download",
    label: "云端",
    Icon: CloudDownload,
    iconClassName: "text-cyan-500 dark:text-cyan-300",
  },
  {
    id: "image",
    label: "图片",
    Icon: Image,
    iconClassName: "text-rose-500 dark:text-rose-300",
  },
  {
    id: "camera",
    label: "截图",
    Icon: Camera,
    iconClassName: "text-fuchsia-500 dark:text-fuchsia-300",
  },
  {
    id: "bookmark",
    label: "书签",
    Icon: Bookmark,
    iconClassName: "text-orange-500 dark:text-orange-300",
  },
  {
    id: "inbox",
    label: "收件箱",
    Icon: Inbox,
    iconClassName: "text-teal-500 dark:text-teal-300",
  },
  {
    id: "archive",
    label: "归档",
    Icon: Archive,
    iconClassName: "text-stone-500 dark:text-stone-300",
  },
  {
    id: "library",
    label: "素材库",
    Icon: Library,
    iconClassName: "text-lime-600 dark:text-lime-300",
  },
  {
    id: "search",
    label: "检索",
    Icon: Search,
    iconClassName: "text-blue-500 dark:text-blue-300",
  },
  {
    id: "telescope",
    label: "望远镜",
    Icon: Telescope,
    iconClassName: "text-purple-500 dark:text-purple-300",
  },
  {
    id: "sparkles",
    label: "灵感",
    Icon: Sparkles,
    iconClassName: "text-yellow-500 dark:text-yellow-300",
  },
];

const BROWSER_COLLECTION_ICON_IDS = new Set<BrowserCollectionIconId>(
  BROWSER_COLLECTION_ICON_OPTIONS.map((option) => option.id),
);

export function isBrowserCollectionIconId(value: unknown): value is BrowserCollectionIconId {
  return (
    typeof value === "string" && BROWSER_COLLECTION_ICON_IDS.has(value as BrowserCollectionIconId)
  );
}

export function getBrowserCollectionIconOption(
  iconId: BrowserCollectionIconId,
): BrowserCollectionIconOption {
  return (
    BROWSER_COLLECTION_ICON_OPTIONS.find((option) => option.id === iconId) ??
    BROWSER_COLLECTION_ICON_OPTIONS[0]
  );
}
