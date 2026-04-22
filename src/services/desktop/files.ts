import { invokeDesktop } from "@/services/desktop/core";
import type {
  AiMetadataTaskSnapshot,
  FileItem,
  ImportTaskSnapshot,
  PaginatedFilesResponse,
  SmartCollectionId,
  SmartCollectionStats,
  VisualIndexTaskSnapshot,
} from "@/stores/fileTypes";

export interface FileFilterPayload {
  query: string | null;
  natural_language_query: string | null;
  folder_id: number | null;
  smart_view: SmartCollectionId | null;
  smart_seed: number | null;
  file_types: string[] | null;
  date_start: string | null;
  date_end: string | null;
  size_min: number | null;
  size_max: number | null;
  tag_ids: number[] | null;
  min_rating: number | null;
  dominant_color: string | null;
  sort_by: string | null;
  sort_direction: string | null;
}

export interface VisualIndexRebuildResult {
  total: number;
  indexed: number;
  failed: number;
  skipped: number;
}

export interface VisualIndexStatus {
  modelValid: boolean;
  message: string;
  modelId: string | null;
  version: string | null;
  requestedDevice: "auto" | "cpu" | "gpu" | null;
  providerPolicy: "auto" | "interactive" | "service" | null;
  runtimeLoaded: boolean;
  runtimeMode: "uninitialized" | "cpu_only" | "gpu_enabled" | "mixed" | "unknown" | null;
  effectiveProvider: "tensorrt" | "cuda" | "direct_ml" | "core_ml" | "cpu" | null;
  runtimeReason: string | null;
  indexedCount: number;
  failedCount: number;
  pendingCount: number;
  outdatedCount: number;
  totalImageCount: number;
}

export interface VisualModelValidationResult {
  valid: boolean;
  message: string;
  normalizedModelPath: string;
  modelId: string | null;
  version: string | null;
  embeddingDim: number | null;
  contextLength: number | null;
  missingFiles: string[];
}

export type AiEndpointTarget = "metadata";

export function getAllFiles(args: {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: string;
}) {
  return invokeDesktop<PaginatedFilesResponse>("get_all_files", args);
}

export function searchFiles(args: {
  query: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: string;
}) {
  return invokeDesktop<PaginatedFilesResponse>("search_files", args);
}

export function getFilesInFolder(args: {
  folderId: number | null;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: string;
}) {
  return invokeDesktop<PaginatedFilesResponse>("get_files_in_folder", args);
}

export function getFile(fileId: number) {
  return invokeDesktop<FileItem>("get_file", { fileId });
}

export function filterFiles(args: { filter: FileFilterPayload; page: number; pageSize: number }) {
  return invokeDesktop<PaginatedFilesResponse>("filter_files", args);
}

export function getSmartCollectionStats() {
  return invokeDesktop<SmartCollectionStats>("get_smart_collection_stats");
}

export function touchFileLastAccessed(fileId: number) {
  return invokeDesktop<void>("touch_file_last_accessed", { fileId });
}

export function updateFileMetadata(args: {
  fileId: number;
  rating: number;
  description: string;
  sourceUrl: string;
}) {
  return invokeDesktop<void>("update_file_metadata", args);
}

export function updateFileDimensions(args: { fileId: number; width: number; height: number }) {
  return invokeDesktop<void>("update_file_dimensions", args);
}

export function getOrCreateThumbHash(filePath: string) {
  return invokeDesktop<string>("get_or_create_thumb_hash", { filePath });
}

export function extractColor(fileId: number) {
  return invokeDesktop<string>("extract_color", { fileId });
}

export function exportFile(fileId: number) {
  return invokeDesktop<string>("export_file", { fileId });
}

export function updateFileName(args: { fileId: number; newName: string }) {
  return invokeDesktop<void>("update_file_name", args);
}

export function analyzeFileMetadata(fileId: number, imageDataUrl?: string) {
  return invokeDesktop<FileItem>("analyze_file_metadata", {
    fileId,
    imageDataUrl,
  });
}

export function startAiMetadataTask(fileIds: number[]) {
  return invokeDesktop<AiMetadataTaskSnapshot>("start_ai_metadata_task", {
    fileIds,
  });
}

export function getAiMetadataTask(taskId: string) {
  return invokeDesktop<AiMetadataTaskSnapshot>("get_ai_metadata_task", { taskId });
}

export function cancelAiMetadataTask(taskId: string) {
  return invokeDesktop<void>("cancel_ai_metadata_task", { taskId });
}

export function rebuildVisualIndex() {
  return invokeDesktop<VisualIndexRebuildResult>("rebuild_visual_index");
}

export function startVisualIndexTask(processUnindexedOnly: boolean) {
  return invokeDesktop<VisualIndexTaskSnapshot>("start_visual_index_task", {
    processUnindexedOnly,
  });
}

export function getVisualIndexTask(taskId: string) {
  return invokeDesktop<VisualIndexTaskSnapshot>("get_visual_index_task", { taskId });
}

export function cancelVisualIndexTask(taskId: string) {
  return invokeDesktop<void>("cancel_visual_index_task", { taskId });
}

export function getVisualIndexStatus() {
  return invokeDesktop<VisualIndexStatus>("get_visual_index_status");
}

export function completeVisualIndexBrowserDecodeRequest(args: {
  requestId: string;
  imageDataUrl?: string;
  error?: string;
}) {
  return invokeDesktop<void>("complete_visual_index_browser_decode_request", args);
}

export function validateVisualModelPath(modelPath: string) {
  return invokeDesktop<VisualModelValidationResult>("validate_visual_model_path", {
    modelPath,
  });
}

export function getRecommendedVisualModelPath() {
  return invokeDesktop<string | null>("get_recommended_visual_model_path");
}

export function testAiEndpoint(target: AiEndpointTarget) {
  return invokeDesktop<string>("test_ai_endpoint", { target });
}

export function importFile(args: { sourcePath: string; folderId?: number | null }) {
  return invokeDesktop<FileItem>("import_file", args);
}

export function importImageFromBase64(args: {
  base64Data: string;
  ext: string;
  folderId?: number | null;
}) {
  return invokeDesktop<FileItem>("import_image_from_base64", args);
}

export function startImportTask(args: {
  items: Array<Record<string, unknown>>;
  folderId?: number | null;
}) {
  return invokeDesktop<ImportTaskSnapshot>("start_import_task", args);
}

export function getImportTask(taskId: string) {
  return invokeDesktop<ImportTaskSnapshot>("get_import_task", { taskId });
}

export function cancelImportTask(taskId: string) {
  return invokeDesktop<void>("cancel_import_task", { taskId });
}

export function retryImportTask(taskId: string) {
  return invokeDesktop<ImportTaskSnapshot>("retry_import_task", { taskId });
}
