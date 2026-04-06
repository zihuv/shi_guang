import { invoke } from '@tauri-apps/api/core'
import { readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { useFileStore } from '@/stores/fileStore'
import { FolderNode, useFolderStore } from '@/stores/folderStore'

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

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff']
const VIDEO_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', '3gp']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma']
const ARCHIVE_EXTENSIONS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']
const WORD_EXTENSIONS = ['doc', 'docx', 'rtf', 'odt']
const SPREADSHEET_EXTENSIONS = ['xls', 'xlsx', 'csv', 'ods']
const PRESENTATION_EXTENSIONS = ['ppt', 'pptx', 'odp', 'key']
const CODE_EXTENSIONS = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'json',
  'html',
  'css',
  'scss',
  'less',
  'md',
  'mdx',
  'rs',
  'py',
  'java',
  'kt',
  'go',
  'c',
  'cpp',
  'h',
  'hpp',
  'sh',
  'ps1',
  'yaml',
  'yml',
  'toml',
  'xml',
]
const TEXT_EXTENSIONS = ['txt', 'log', 'ini', 'conf']
const TEXT_PREVIEW_EXTENSIONS = ['txt', 'log', 'md', 'csv', 'ini', 'conf']
const MAX_TEXT_PREVIEW_SIZE = 512 * 1024
const videoThumbnailPromiseCache = new Map<string, Promise<string>>()
const missingFileSyncs = new Set<string>()
const MISSING_FILE_ERROR_MARKERS = [
  'No such file or directory',
  'The system cannot find the file specified',
  '系统找不到指定的文件',
  '(os error 2)',
]

function normalizeFsPath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function isMissingFileError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? '')
  return MISSING_FILE_ERROR_MARKERS.some((marker) => message.includes(marker))
}

function findMatchingIndexPath(filePath: string, indexPaths: string[]): string | null {
  const normalizedFilePath = normalizeFsPath(filePath)
  let match: string | null = null

  for (const indexPath of indexPaths) {
    const normalizedIndexPath = normalizeFsPath(indexPath)
    if (
      normalizedFilePath === normalizedIndexPath ||
      normalizedFilePath.startsWith(`${normalizedIndexPath}\\`)
    ) {
      if (!match || normalizedIndexPath.length > normalizeFsPath(match).length) {
        match = indexPath
      }
    }
  }

  return match
}

async function refreshVisibleLibraryState() {
  try {
    await useFolderStore.getState().loadFolders()
    const fileStore = useFileStore.getState()
    await fileStore.loadFilesInFolder(fileStore.selectedFolderId)
  } catch (error) {
    console.error('Failed to refresh library state:', error)
  }
}

function scheduleMissingFileCleanup(path: string) {
  void (async () => {
    try {
      const indexPaths = await invoke<string[]>('get_index_paths')
      const matchingIndexPath = findMatchingIndexPath(path, indexPaths)
      if (!matchingIndexPath || missingFileSyncs.has(matchingIndexPath)) {
        return
      }

      missingFileSyncs.add(matchingIndexPath)
      try {
        await invoke('sync_index_path', { path: matchingIndexPath })
        await refreshVisibleLibraryState()
      } finally {
        missingFileSyncs.delete(matchingIndexPath)
      }
    } catch (error) {
      console.error('Failed to sync missing file cleanup:', error)
    }
  })()
}

export type FilePreviewMode = 'image' | 'video' | 'pdf' | 'text' | 'none'
export type FileKind =
  | 'image'
  | 'video'
  | 'pdf'
  | 'audio'
  | 'archive'
  | 'spreadsheet'
  | 'presentation'
  | 'word'
  | 'code'
  | 'text'
  | 'other'

export function normalizeExt(ext: string): string {
  return ext.replace(/^\./, '').toLowerCase()
}

export function getFileMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export function isImageFile(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(normalizeExt(ext))
}

export function isVideoFile(ext: string): boolean {
  return VIDEO_EXTENSIONS.includes(normalizeExt(ext))
}

export function isPdfFile(ext: string): boolean {
  return normalizeExt(ext) === 'pdf'
}

export function isTextPreviewFile(ext: string): boolean {
  return TEXT_PREVIEW_EXTENSIONS.includes(normalizeExt(ext))
}

export function getFilePreviewMode(ext: string): FilePreviewMode {
  if (isImageFile(ext)) {
    return 'image'
  }
  if (isVideoFile(ext)) {
    return 'video'
  }
  if (isPdfFile(ext)) {
    return 'pdf'
  }
  if (isTextPreviewFile(ext)) {
    return 'text'
  }
  return 'none'
}

export function canPreviewFile(ext: string): boolean {
  return getFilePreviewMode(ext) !== 'none'
}

export function canGenerateThumbnail(ext: string): boolean {
  return isImageFile(ext) || isVideoFile(ext)
}

export function getFileKind(ext: string): FileKind {
  const normalizedExt = normalizeExt(ext)

  if (isImageFile(normalizedExt)) {
    return 'image'
  }
  if (isVideoFile(normalizedExt)) {
    return 'video'
  }
  if (isPdfFile(normalizedExt)) {
    return 'pdf'
  }
  if (AUDIO_EXTENSIONS.includes(normalizedExt)) {
    return 'audio'
  }
  if (ARCHIVE_EXTENSIONS.includes(normalizedExt)) {
    return 'archive'
  }
  if (SPREADSHEET_EXTENSIONS.includes(normalizedExt)) {
    return 'spreadsheet'
  }
  if (PRESENTATION_EXTENSIONS.includes(normalizedExt)) {
    return 'presentation'
  }
  if (WORD_EXTENSIONS.includes(normalizedExt)) {
    return 'word'
  }
  if (CODE_EXTENSIONS.includes(normalizedExt)) {
    return 'code'
  }
  if (TEXT_EXTENSIONS.includes(normalizedExt)) {
    return 'text'
  }
  return 'other'
}

export async function getFileSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path)
    const blob = new Blob([contents], { type: getFileMimeType(path) })
    return URL.createObjectURL(blob)
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    console.error('Failed to read file:', e)
    return ''
  }
}

export async function getTextPreviewContent(path: string, size?: number): Promise<string> {
  if (size && size > MAX_TEXT_PREVIEW_SIZE) {
    return '文件较大，暂不显示完整文本预览。'
  }

  try {
    return await readTextFile(path)
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return '文件不存在或已被删除。'
    }
    console.error('Failed to read text file:', e)
    return '文本预览加载失败。'
  }
}

async function renderVideoThumbnailDataUrl(path: string): Promise<string> {
  const fileSrc = await getFileSrc(path)
  if (!fileSrc) {
    return ''
  }

  return await new Promise<string>((resolve) => {
    const video = document.createElement('video')
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
      if (fileSrc.startsWith('blob:')) {
        URL.revokeObjectURL(fileSrc)
      }
    }

    const finish = (value: string) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }

    const captureFrame = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish('')
        return
      }

      const maxEdge = 320
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        finish('')
        return
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL('image/jpeg', 0.82))
    }

    const seekToCapturePoint = () => {
      const hasDuration = Number.isFinite(video.duration) && video.duration > 0
      const targetTime = hasDuration ? Math.min(0.1, video.duration / 3) : 0

      if (targetTime <= 0) {
        if (video.readyState >= 2) {
          captureFrame()
        } else {
          video.addEventListener('loadeddata', captureFrame, { once: true })
        }
        return
      }

      video.addEventListener('seeked', captureFrame, { once: true })
      try {
        video.currentTime = targetTime
      } catch {
        captureFrame()
      }
    }

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.addEventListener('loadedmetadata', seekToCapturePoint, { once: true })
    video.addEventListener('error', () => finish(''), { once: true })
    timeoutId = setTimeout(() => finish(''), 10000)
    video.src = fileSrc
    video.load()
  })
}

async function persistThumbnailDataUrl(path: string, dataUrl: string): Promise<void> {
  const dataBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  if (!dataBase64) {
    return
  }

  try {
    await invoke('save_thumbnail_cache', {
      filePath: path,
      dataBase64,
    })
  } catch (e) {
    console.error('Failed to persist thumbnail:', e)
  }
}

export async function getVideoThumbnailSrc(path: string): Promise<string> {
  const cachedThumbnailSrc = await getThumbnailImageSrc(path)
  if (cachedThumbnailSrc) {
    return cachedThumbnailSrc
  }

  const pending = videoThumbnailPromiseCache.get(path)
  if (pending) {
    return pending
  }

  const nextThumbnailPromise = renderVideoThumbnailDataUrl(path)
    .then(async (thumbnailDataUrl) => {
      if (!thumbnailDataUrl) {
        return ''
      }

      await persistThumbnailDataUrl(path, thumbnailDataUrl)
      return thumbnailDataUrl
    })
    .finally(() => {
      videoThumbnailPromiseCache.delete(path)
    })

  videoThumbnailPromiseCache.set(path, nextThumbnailPromise)
  return nextThumbnailPromise
}

// Helper to get image URL from file path using fs plugin
export async function getImageSrc(path: string): Promise<string> {
  return getFileSrc(path)
}

export async function getThumbnailImageSrc(path: string, ext?: string): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return ''
  }

  try {
    const thumbnailDataBase64 = await invoke<string | null>('get_thumbnail_data_base64', {
      filePath: path,
    })

    if (!thumbnailDataBase64) {
      return ''
    }

    return `data:image/jpeg;base64,${thumbnailDataBase64}`
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
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
