import { invokeTauri } from "@/services/tauri/core"
import type { FileItem, ImportTaskSnapshot, PaginatedFilesResponse } from "@/stores/fileTypes"

export interface FileFilterPayload {
  query: string | null
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
