export interface Tag {
  id: number
  name: string
  color: string
}

export interface FileItem {
  id: number
  path: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  folderId: number | null
  createdAt: string
  modifiedAt: string
  importedAt: string
  rating: number
  description: string
  sourceUrl: string
  dominantColor: string
  colorDistribution: Array<{ color: string; percentage: number }>
  tags: Tag[]
  deletedAt?: string | null
}

export interface PaginatedFilesResponse {
  files: FileItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
  debugScores?: VisualSearchDebugScore[]
}

export interface VisualSearchDebugScore {
  fileId: number
  name: string
  score: number
}

export interface ImportTaskItemResult {
  index: number
  status: string
  source: string
  error?: string | null
  file?: FileItem | null
}

export interface ImportTaskSnapshot {
  id: string
  status: string
  total: number
  processed: number
  successCount: number
  failureCount: number
  results: ImportTaskItemResult[]
}

export interface AiMetadataTaskItemResult {
  index: number
  fileId: number
  status: string
  attempts: number
  error?: string | null
  file?: FileItem | null
}

export interface AiMetadataTaskSnapshot {
  id: string
  status: string
  total: number
  processed: number
  successCount: number
  failureCount: number
  results: AiMetadataTaskItemResult[]
}

export const TERMINAL_IMPORT_TASK_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "cancelled",
  "failed",
])

export const TERMINAL_AI_METADATA_TASK_STATUSES = new Set([
  "completed",
  "completed_with_errors",
  "cancelled",
  "failed",
])

export const getNameWithoutExt = (name: string): string => {
  const lastDot = name.lastIndexOf(".")
  if (lastDot > 0) {
    return name.substring(0, lastDot)
  }
  return name
}

export const parseFile = (file: FileItem): FileItem => ({
  ...file,
  colorDistribution:
    typeof file.colorDistribution === "string"
      ? JSON.parse(file.colorDistribution)
      : (file.colorDistribution || []),
})

export const parseFileList = (files: FileItem[]): FileItem[] => files.map(parseFile)
