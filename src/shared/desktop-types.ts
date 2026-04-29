export interface FileTag {
  id: number;
  name: string;
  color: string;
}

export interface FileItem {
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
  colorDistribution: Array<{ color: string; percentage: number }>;
  thumbHash: string;
  contentHash?: string | null;
  tags: FileTag[];
  deletedAt?: string | null;
  missingAt?: string | null;
  trashPreviewPath?: string | null;
}

export type SmartCollectionId =
  | "all"
  | "unclassified"
  | "untagged"
  | "recent"
  | "random"
  | "similar";

export interface SmartCollectionStats {
  allCount: number;
  unclassifiedCount: number;
  untaggedCount: number;
}

export interface FolderNode {
  id: number;
  name: string;
  path: string;
  children: FolderNode[];
  fileCount: number;
  isSystem?: boolean;
  sortOrder?: number;
  parentId?: number | null;
}

export interface FolderSummary {
  id: number;
  name: string;
  path: string;
  parent_id: number | null;
  created_at: string;
}

export interface DeleteFolderResult {
  folderId: number;
  folderName: string;
  folderPath: string;
  removedFileCount: number;
  movedToTrash: boolean;
}

export interface TagNode {
  id: number;
  name: string;
  color: string;
  count: number;
  parentId: number | null;
  sortOrder?: number;
  children: TagNode[];
}

export type RawTag = Omit<TagNode, "children">;

export interface TrashFolderItem {
  kind: "folder";
  id: number;
  name: string;
  path: string;
  deletedAt: string;
  fileCount: number;
  subfolderCount: number;
}

export interface TrashFileItem extends FileItem {
  kind: "file";
}

export type TrashItem = TrashFileItem | TrashFolderItem;

export interface VisualSearchDebugScore {
  fileId: number;
  name: string;
  score: number;
}

export interface PaginatedFilesResponse {
  files: FileItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  debugScores?: VisualSearchDebugScore[];
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
  file?: FileItem | null;
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
  file?: FileItem | null;
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

export type VisualModelDownloadStatus =
  | "queued"
  | "scanning"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface VisualModelDownloadSnapshot {
  id: string;
  status: VisualModelDownloadStatus;
  repoId: string;
  modelName: string;
  mirrorUrl: string;
  targetDir: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  currentFileName?: string | null;
  error?: string | null;
}
