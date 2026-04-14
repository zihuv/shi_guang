import { invokeTauri } from "@/services/tauri/core"
import type {
  AiMetadataTaskSnapshot,
  FileItem,
  ImportTaskSnapshot,
  PaginatedFilesResponse,
  VisualIndexTaskSnapshot,
} from "@/stores/fileTypes"

export interface FileFilterPayload {
  query: string | null
  natural_language_query: string | null
  folder_id: number | null
  file_types: string[] | null
  date_start: string | null
  date_end: string | null
  size_min: number | null
  size_max: number | null
  tag_ids: number[] | null
  min_rating: number | null
  favorites_only: boolean | null
  dominant_color: string | null
  sort_by: string | null
  sort_direction: string | null
}

export interface VisualIndexRebuildResult {
  total: number
  indexed: number
  failed: number
  skipped: number
}

export interface VisualIndexStatus {
  modelValid: boolean
  message: string
  modelId: string | null
  version: string | null
  indexedCount: number
  failedCount: number
  pendingCount: number
  outdatedCount: number
  totalImageCount: number
}

export interface VisualModelValidationResult {
  valid: boolean
  message: string
  normalizedModelPath: string
  modelId: string | null
  version: string | null
  embeddingDim: number | null
  contextLength: number | null
  missingFiles: string[]
}

export interface VisualIndexRetryCandidate {
  fileId: number
  path: string
  ext: string
  lastError: string
}

export type AiEndpointTarget = "metadata"

export function getAllFiles(args: {
  page: number
  pageSize: number
  sortBy: string
  sortDirection: string
}) {
  return invokeTauri<PaginatedFilesResponse>("get_all_files", args)
}

export function searchFiles(args: {
  query: string
  page: number
  pageSize: number
  sortBy: string
  sortDirection: string
}) {
  return invokeTauri<PaginatedFilesResponse>("search_files", args)
}

export function getFilesInFolder(args: {
  folderId: number | null
  page: number
  pageSize: number
  sortBy: string
  sortDirection: string
}) {
  return invokeTauri<PaginatedFilesResponse>("get_files_in_folder", args)
}

export function getFile(fileId: number) {
  return invokeTauri<FileItem>("get_file", { fileId })
}

export function filterFiles(args: {
  filter: FileFilterPayload
  page: number
  pageSize: number
}) {
  return invokeTauri<PaginatedFilesResponse>("filter_files", args)
}

export function updateFileMetadata(args: {
  fileId: number
  rating: number
  description: string
  sourceUrl: string
}) {
  return invokeTauri<void>("update_file_metadata", args)
}

export function updateFileDimensions(args: {
  fileId: number
  width: number
  height: number
}) {
  return invokeTauri<void>("update_file_dimensions", args)
}

export function extractColor(fileId: number) {
  return invokeTauri<string>("extract_color", { fileId })
}

export function exportFile(fileId: number) {
  return invokeTauri<string>("export_file", { fileId })
}

export function updateFileName(args: { fileId: number; newName: string }) {
  return invokeTauri<void>("update_file_name", args)
}

export function analyzeFileMetadata(fileId: number, imageDataUrl?: string) {
  return invokeTauri<FileItem>("analyze_file_metadata", {
    fileId,
    imageDataUrl,
  })
}

export function startAiMetadataTask(fileIds: number[]) {
  return invokeTauri<AiMetadataTaskSnapshot>("start_ai_metadata_task", {
    fileIds,
  })
}

export function getAiMetadataTask(taskId: string) {
  return invokeTauri<AiMetadataTaskSnapshot>("get_ai_metadata_task", { taskId })
}

export function cancelAiMetadataTask(taskId: string) {
  return invokeTauri<void>("cancel_ai_metadata_task", { taskId })
}

export function rebuildVisualIndex() {
  return invokeTauri<VisualIndexRebuildResult>("rebuild_visual_index")
}

export function startVisualIndexTask(processUnindexedOnly: boolean) {
  return invokeTauri<VisualIndexTaskSnapshot>("start_visual_index_task", {
    processUnindexedOnly,
  })
}

export function getVisualIndexTask(taskId: string) {
  return invokeTauri<VisualIndexTaskSnapshot>("get_visual_index_task", { taskId })
}

export function cancelVisualIndexTask(taskId: string) {
  return invokeTauri<void>("cancel_visual_index_task", { taskId })
}

export function reindexFileVisualEmbedding(fileId: number, imageDataUrl?: string) {
  return invokeTauri<void>("reindex_file_visual_embedding", {
    fileId,
    imageDataUrl,
  })
}

export function getVisualIndexStatus() {
  return invokeTauri<VisualIndexStatus>("get_visual_index_status")
}

export function getVisualIndexRetryCandidates() {
  return invokeTauri<VisualIndexRetryCandidate[]>("get_visual_index_retry_candidates")
}

export function completeVisualIndexBrowserDecodeRequest(args: {
  requestId: string
  imageDataUrl?: string
  error?: string
}) {
  return invokeTauri<void>("complete_visual_index_browser_decode_request", args)
}

export function validateVisualModelPath(modelPath: string) {
  return invokeTauri<VisualModelValidationResult>("validate_visual_model_path", {
    modelPath,
  })
}

export function getRecommendedVisualModelPath() {
  return invokeTauri<string | null>("get_recommended_visual_model_path")
}

export function testAiEndpoint(target: AiEndpointTarget) {
  return invokeTauri<string>("test_ai_endpoint", { target })
}

export function importFile(args: {
  sourcePath: string
  folderId?: number | null
}) {
  return invokeTauri<FileItem>("import_file", args)
}

export function importImageFromBase64(args: {
  base64Data: string
  ext: string
  folderId?: number | null
}) {
  return invokeTauri<FileItem>("import_image_from_base64", args)
}

export function startImportTask(args: {
  items: Array<Record<string, unknown>>
  folderId?: number | null
}) {
  return invokeTauri<ImportTaskSnapshot>("start_import_task", args)
}

export function getImportTask(taskId: string) {
  return invokeTauri<ImportTaskSnapshot>("get_import_task", { taskId })
}

export function cancelImportTask(taskId: string) {
  return invokeTauri<void>("cancel_import_task", { taskId })
}

export function retryImportTask(taskId: string) {
  return invokeTauri<ImportTaskSnapshot>("retry_import_task", { taskId })
}
