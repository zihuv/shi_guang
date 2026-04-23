export interface TagRecord {
  id: number;
  name: string;
  color: string;
  count: number;
  parentId: number | null;
  sortOrder: number;
}

export interface FileRecord {
  id: number;
  path: string;
  name: string;
  ext: string;
  size: number;
  width: number;
  height: number;
  folderId: number | null;
  createdAt: string;
  modifiedAt: string;
  importedAt: string;
  lastAccessedAt: string | null;
  rating: number;
  description: string;
  sourceUrl: string;
  dominantColor: string;
  colorDistribution: string;
  thumbHash: string;
  contentHash: string | null;
  tags: TagRecord[];
  deletedAt: string | null;
  missingAt: string | null;
}

export type SmartCollectionId = "all" | "unclassified" | "untagged" | "recent" | "random";

export interface SmartCollectionStats {
  allCount: number;
  unclassifiedCount: number;
  untaggedCount: number;
}

export interface FolderRecord {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  created_at: string;
  isSystem: boolean;
  sortOrder: number;
  deletedAt: string | null;
}

export interface FolderTreeNode {
  id: number;
  name: string;
  path: string;
  children: FolderTreeNode[];
  fileCount: number;
  isSystem?: boolean;
  sortOrder?: number;
  parentId?: number | null;
}

export interface TrashFolderRecord {
  id: number;
  path: string;
  name: string;
  deletedAt: string;
  fileCount: number;
  subfolderCount: number;
}

export type TrashItemRecord =
  | (FileRecord & { kind: "file" })
  | (TrashFolderRecord & { kind: "folder" });

export interface PaginatedFiles {
  files: FileRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  debugScores?: Array<{ fileId: number; name: string; score: number }>;
}

export interface BinaryImageImportItem {
  bytes?: Uint8Array;
  ext: string;
  sourcePath?: string;
  rating?: number;
  description?: string;
  sourceUrl?: string;
  tagIds?: number[];
}

export interface ImportTaskItem {
  kind?: string;
  path?: string;
  sourcePath?: string;
  base64Data?: string;
  base64_data?: string;
  bytes?: Uint8Array;
  ext?: string;
  rating?: number;
  description?: string;
  sourceUrl?: string;
  source_url?: string;
  tagIds?: number[];
  tag_ids?: number[];
}

export interface ImportTaskItemResult {
  index: number;
  status: string;
  source: string;
  error?: string | null;
  file?: FileRecord | null;
}

export interface ImportTaskSnapshot {
  id: string;
  status: string;
  total: number;
  processed: number;
  successCount: number;
  failureCount: number;
  results: ImportTaskItemResult[];
}

export interface AiMetadataTaskItemResult {
  index: number;
  fileId: number;
  status: string;
  attempts: number;
  error?: string | null;
  file?: FileRecord | null;
}

export interface AiMetadataTaskSnapshot {
  id: string;
  status: string;
  total: number;
  processed: number;
  successCount: number;
  failureCount: number;
  results: AiMetadataTaskItemResult[];
}

export interface VisualIndexTaskSnapshot {
  id: string;
  status: string;
  total: number;
  processed: number;
  indexedCount: number;
  failureCount: number;
  skippedCount: number;
  currentFileId?: number | null;
  currentFileName?: string | null;
  processUnindexedOnly: boolean;
}

export interface AppState {
  db: import("better-sqlite3").Database;
  dbPath: string;
  appDataDir: string;
  indexPath: string;
  importTasks: Map<
    string,
    {
      snapshot: ImportTaskSnapshot;
      items: ImportTaskItem[];
      folderId: number | null;
      cancelled: boolean;
    }
  >;
  aiMetadataTasks: Map<string, { snapshot: AiMetadataTaskSnapshot; cancelled: boolean }>;
  visualIndexTasks: Map<string, { snapshot: VisualIndexTaskSnapshot; cancelled: boolean }>;
}
