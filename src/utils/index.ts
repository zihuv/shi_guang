import { invoke } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { FolderNode } from '@/stores/folderStore'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  m4v: 'video/mp4',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
}

export function getFileMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export function isVideoFile(ext: string): boolean {
  return ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp'].includes(ext.toLowerCase())
}

export function isPdfFile(ext: string): boolean {
  return ext.toLowerCase() === 'pdf'
}

// Helper to get image URL from file path using fs plugin
export async function getImageSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path)
    const blob = new Blob([contents], { type: getFileMimeType(path) })
    return URL.createObjectURL(blob)
  } catch (e: any) {
    // 文件不存在或已删除，静默处理，不显示错误
    if (e?.message?.includes('No such file or directory')) {
      return ''
    }
    console.error('Failed to read file:', e)
    return ''
  }
}

export async function getThumbnailImageSrc(path: string): Promise<string> {
  try {
    const thumbnailPath = await invoke<string | null>('get_thumbnail_path', {
      filePath: path,
    })

    if (!thumbnailPath) {
      return ''
    }

    return await getImageSrc(thumbnailPath)
  } catch (e) {
    console.error('Failed to get thumbnail path:', e)
    return ''
  }
}

// Format file size to human readable string
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Find folder by ID in the folder tree
export function findFolderById(folders: FolderNode[], id: number): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder
    }
    const found = findFolderById(folder.children, id)
    if (found) {
      return found
    }
  }
  return null
}

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      func(...args)
    }, wait)
  }
}
