import { convertFileSrc } from '@tauri-apps/api/core'
import { exists, readFile, readTextFile } from '@tauri-apps/plugin-fs'
import { getIndexPaths, getThumbnailPath, saveThumbnailCache, syncIndexPath } from '@/services/tauri/indexing'
import { useLibraryQueryStore } from '@/stores/libraryQueryStore'
import { FolderNode, useFolderStore } from '@/stores/folderStore'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
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

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico', 'tif', 'tiff']
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
const THUMBNAIL_CACHE_VERSION = 'v2'
const THUMBNAIL_MAX_EDGE = 320
export const LIST_THUMBNAIL_MAX_EDGE = 160
export const MAX_THUMBNAIL_MAX_EDGE = 640
const THUMBNAIL_VARIANT_MAX_EDGES = [
  LIST_THUMBNAIL_MAX_EDGE,
  224,
  THUMBNAIL_MAX_EDGE,
  448,
  MAX_THUMBNAIL_MAX_EDGE,
] as const
const DEFAULT_THUMBNAIL_DEVICE_PIXEL_RATIO_CAP = 1
const THUMBNAIL_JPEG_QUALITY = 0.88
const videoThumbnailPromiseCache = new Map<string, Promise<string>>()
const browserThumbnailPromiseCache = new Map<string, Promise<string>>()
const missingFileSyncs = new Set<string>()
const MISSING_FILE_ERROR_MARKERS = [
  'No such file or directory',
  'The system cannot find the file specified',
  '系统找不到指定的文件',
  '(os error 2)',
]

function getThumbnailVariantCacheKey(path: string, maxEdge: number) {
  return `${THUMBNAIL_CACHE_VERSION}:${path}::${maxEdge}`
}

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
    const libraryStore = useLibraryQueryStore.getState()
    await libraryStore.loadFilesInFolder(libraryStore.selectedFolderId)
  } catch (error) {
    console.error('Failed to refresh library state:', error)
  }
}

function scheduleMissingFileCleanup(path: string) {
  void (async () => {
    try {
      const indexPaths = await getIndexPaths()
      const matchingIndexPath = findMatchingIndexPath(path, indexPaths)
      if (!matchingIndexPath || missingFileSyncs.has(matchingIndexPath)) {
        return
      }

      missingFileSyncs.add(matchingIndexPath)
      try {
        await syncIndexPath(matchingIndexPath)
        await refreshVisibleLibraryState()
      } finally {
        missingFileSyncs.delete(matchingIndexPath)
      }
    } catch (error) {
      console.error('Failed to sync missing file cleanup:', error)
    }
  })()
}

function toAssetSrc(path: string): string {
  return convertFileSrc(path)
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

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) {
    return false
  }

  return signature.every((value, index) => bytes[offset + index] === value)
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  return Array.from(bytes.slice(start, end))
    .map((byte) => String.fromCharCode(byte))
    .join("")
}

function detectMimeTypeFromContents(bytes: Uint8Array, path: string): string {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg"
  }
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }
  if (asciiSlice(bytes, 0, 4) === "GIF8") {
    return "image/gif"
  }
  if (asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "WEBP") {
    return "image/webp"
  }
  if (asciiSlice(bytes, 4, 8) === "ftyp") {
    const brands = asciiSlice(bytes, 8, Math.min(bytes.length, 32))
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif"
    }
    if (brands.includes("mif1") || brands.includes("heic") || brands.includes("heif")) {
      return "image/heif"
    }
  }
  if (hasSignature(bytes, [0x42, 0x4d])) {
    return "image/bmp"
  }
  if (hasSignature(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasSignature(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff"
  }
  if (hasSignature(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return "image/x-icon"
  }

  const textHead = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 256)).trimStart()
  if (textHead.startsWith("<svg") || textHead.startsWith("<?xml")) {
    return "image/svg+xml"
  }

  return getFileMimeType(path)
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

export function resolveThumbnailRequestMaxEdge(
  renderWidth: number,
  renderHeight: number = renderWidth,
  options: {
    devicePixelRatioCap?: number
  } = {},
): number {
  const safeWidth = Number.isFinite(renderWidth) ? Math.max(1, renderWidth) : THUMBNAIL_MAX_EDGE
  const safeHeight = Number.isFinite(renderHeight) ? Math.max(1, renderHeight) : safeWidth
  const devicePixelRatioCap =
    options.devicePixelRatioCap ?? DEFAULT_THUMBNAIL_DEVICE_PIXEL_RATIO_CAP
  const dpr =
    typeof window === 'undefined' || !Number.isFinite(window.devicePixelRatio)
      ? 1
      : Math.min(window.devicePixelRatio, Math.max(1, devicePixelRatioCap))
  const targetEdge = Math.ceil(Math.max(safeWidth, safeHeight) * dpr)

  for (const edge of THUMBNAIL_VARIANT_MAX_EDGES) {
    if (targetEdge <= edge) {
      return edge
    }
  }

  return THUMBNAIL_VARIANT_MAX_EDGES[THUMBNAIL_VARIANT_MAX_EDGES.length - 1]
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
    if (!(await exists(path))) {
      scheduleMissingFileCleanup(path)
      return ''
    }

    return toAssetSrc(path)
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    try {
      const contents = await readFile(path)
      const blob = new Blob([contents], { type: detectMimeTypeFromContents(contents, path) })
      return URL.createObjectURL(blob)
    } catch (readError: any) {
      if (isMissingFileError(readError)) {
        scheduleMissingFileCleanup(path)
        return ''
      }
      console.error('Failed to read file:', readError)
      return ''
    }
  }
}

export interface BrowserDecodedImageOptions {
  maxEdge?: number
  quality?: number
  outputMimeType?: string
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

async function renderVideoThumbnailDataUrl(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
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

      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        finish('')
        return
      }

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY))
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

async function persistThumbnailDataUrl(
  path: string,
  dataUrl: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const dataBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  if (!dataBase64) {
    return ''
  }

  try {
    const thumbnailPath = await saveThumbnailCache({
      filePath: path,
      dataBase64,
      maxEdge,
    })
    return thumbnailPath ? toAssetSrc(thumbnailPath) : ''
  } catch (e) {
    console.error('Failed to persist thumbnail:', e)
    return ''
  }
}

async function getBrowserThumbnailSrc(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const cacheKey = getThumbnailVariantCacheKey(path, maxEdge)
  const pending = browserThumbnailPromiseCache.get(cacheKey)
  if (pending) {
    return pending
  }

  const nextThumbnailPromise = buildBrowserDecodedImageDataUrl(path, {
    maxEdge,
    quality: THUMBNAIL_JPEG_QUALITY,
    outputMimeType: 'image/jpeg',
  })
    .then(async (thumbnailDataUrl) => {
      if (!thumbnailDataUrl) {
        return ''
      }

      const persistedThumbnailSrc = await persistThumbnailDataUrl(path, thumbnailDataUrl, maxEdge)
      return persistedThumbnailSrc || thumbnailDataUrl
    })
    .catch((error) => {
      console.error('Failed to generate browser thumbnail:', error)
      return ''
    })
    .finally(() => {
      browserThumbnailPromiseCache.delete(cacheKey)
    })

  browserThumbnailPromiseCache.set(cacheKey, nextThumbnailPromise)
  return nextThumbnailPromise
}

export async function generateBrowserThumbnailCache(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  return getBrowserThumbnailSrc(path, maxEdge)
}

export async function getVideoThumbnailSrc(
  path: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  const cachedThumbnailSrc = await getThumbnailImageSrc(path, undefined, maxEdge)
  if (cachedThumbnailSrc) {
    return cachedThumbnailSrc
  }

  const cacheKey = getThumbnailVariantCacheKey(path, maxEdge)
  const pending = videoThumbnailPromiseCache.get(cacheKey)
  if (pending) {
    return pending
  }

  const nextThumbnailPromise = renderVideoThumbnailDataUrl(path, maxEdge)
    .then(async (thumbnailDataUrl) => {
      if (!thumbnailDataUrl) {
        return ''
      }

      const persistedThumbnailSrc = await persistThumbnailDataUrl(path, thumbnailDataUrl, maxEdge)
      return persistedThumbnailSrc || thumbnailDataUrl
    })
    .finally(() => {
      videoThumbnailPromiseCache.delete(cacheKey)
    })

  videoThumbnailPromiseCache.set(cacheKey, nextThumbnailPromise)
  return nextThumbnailPromise
}

// Helper to get image URL from file path using fs plugin
export async function getImageSrc(path: string): Promise<string> {
  return getFileSrc(path)
}

async function getCanvasSafeImageSrc(path: string): Promise<string> {
  try {
    const contents = await readFile(path)
    const blob = new Blob([contents], { type: detectMimeTypeFromContents(contents, path) })
    return URL.createObjectURL(blob)
  } catch (e: any) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    console.error('Failed to read canvas-safe image source:', e)
    return ''
  }
}

export async function buildBrowserDecodedImageDataUrl(
  path: string,
  options: BrowserDecodedImageOptions = {},
): Promise<string> {
  const sourceUrl = await getCanvasSafeImageSrc(path)
  if (!sourceUrl) {
    throw new Error("无法读取图片文件")
  }

  return await new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = "anonymous"

    const cleanup = () => {
      image.onload = null
      image.onerror = null
      if (sourceUrl.startsWith("blob:")) {
        URL.revokeObjectURL(sourceUrl)
      }
    }

    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (!width || !height) {
        cleanup()
        reject(new Error("图片尺寸无效"))
        return
      }

      const maxEdge = options.maxEdge ?? 1280
      const scale = Math.min(1, maxEdge / Math.max(width, height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext("2d")

      if (!ctx) {
        cleanup()
        reject(new Error("无法创建图片画布"))
        return
      }

      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

      try {
        const dataUrl = canvas.toDataURL(
          options.outputMimeType ?? "image/jpeg",
          options.quality ?? 0.85,
        )
        cleanup()
        resolve(dataUrl)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    image.onerror = () => {
      cleanup()
      reject(new Error("浏览器无法解码该图片"))
    }

    image.src = sourceUrl
  })
}

export async function buildAiImageDataUrl(path: string): Promise<string> {
  return buildBrowserDecodedImageDataUrl(path, {
    maxEdge: 1280,
    quality: 0.85,
    outputMimeType: "image/jpeg",
  })
}

export async function getThumbnailImageSrc(
  path: string,
  ext?: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return ''
  }

  try {
    const thumbnailPath = await getThumbnailPath(path, maxEdge)
    if (thumbnailPath) {
      return toAssetSrc(thumbnailPath)
    }
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    console.error('Failed to get thumbnail path:', e)
  }

  if (ext && isImageFile(ext)) {
    return getBrowserThumbnailSrc(path, maxEdge)
  }

  return ''
}

export async function getThumbnailBlobSrc(
  path: string,
  ext?: string,
  maxEdge: number = THUMBNAIL_MAX_EDGE,
): Promise<string> {
  if (ext && !canGenerateThumbnail(ext)) {
    return ''
  }

  try {
    const thumbnailPath = await getThumbnailPath(path, maxEdge)
    if (thumbnailPath) {
      return await getCanvasSafeImageSrc(thumbnailPath)
    }
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    console.error('Failed to get thumbnail blob source:', e)
  }

  const generatedSrc = await getBrowserThumbnailSrc(path, maxEdge)
  if (!generatedSrc) {
    return ''
  }

  try {
    const persistedThumbnailPath = await getThumbnailPath(path, maxEdge)
    if (persistedThumbnailPath) {
      return await getCanvasSafeImageSrc(persistedThumbnailPath)
    }
  } catch (e) {
    if (isMissingFileError(e)) {
      scheduleMissingFileCleanup(path)
      return ''
    }
    console.error('Failed to re-read persisted thumbnail as blob:', e)
  }

  return generatedSrc
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
