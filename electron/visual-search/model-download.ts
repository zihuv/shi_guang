import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { net, type BrowserWindow } from "electron";
import { taskId } from "../commands/common";
import type { AppState, VisualModelDownloadSnapshot } from "../types";

export const HF_MIRROR_URL = "https://hf-mirror.com";

const VISUAL_MODEL_REPOS = {
  "zihuv/fg-clip2-base-onnx": {
    modelName: "FG-CLIP2 ONNX",
    folderName: "fg-clip2-base-onnx",
  },
  "zihuv/chinese-clip-vit-base-patch16-onnx": {
    modelName: "Chinese-CLIP ONNX",
    folderName: "chinese-clip-vit-base-patch16-onnx",
  },
} as const;

interface HuggingFaceModelInfo {
  sha?: string;
  usedStorage?: number;
  siblings?: Array<{
    rfilename?: string;
  }>;
}

interface DownloadFile {
  name: string;
  size: number;
}

export function startVisualModelDownload(
  state: AppState,
  window: BrowserWindow | null,
  repoId: string,
  targetParentDir: string,
): VisualModelDownloadSnapshot {
  const repo = VISUAL_MODEL_REPOS[repoId as keyof typeof VISUAL_MODEL_REPOS];
  if (!repo) {
    throw new Error("不支持的视觉模型。");
  }

  const normalizedParentDir = path.resolve(targetParentDir.trim());
  const targetDir = path.join(normalizedParentDir, repo.folderName);
  const id = taskId();
  const abortController = new AbortController();
  const snapshot: VisualModelDownloadSnapshot = {
    id,
    status: "queued",
    repoId,
    modelName: repo.modelName,
    mirrorUrl: HF_MIRROR_URL,
    targetDir,
    totalFiles: 0,
    completedFiles: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    currentFileName: null,
    error: null,
  };

  state.visualModelDownloadTasks.set(id, { snapshot, abortController });

  void runVisualModelDownload(state, window, snapshot, abortController).catch((error) => {
    if (abortController.signal.aborted) {
      snapshot.status = "cancelled";
      snapshot.error = null;
    } else {
      snapshot.status = "failed";
      snapshot.error = error instanceof Error ? error.message : String(error);
    }
    emitDownloadSnapshot(window, snapshot);
    state.visualModelDownloadTasks.delete(id);
  });

  emitDownloadSnapshot(window, snapshot);
  return { ...snapshot };
}

export function cancelVisualModelDownload(state: AppState, taskId: string): void {
  const task = state.visualModelDownloadTasks.get(taskId);
  if (!task) {
    throw new Error("模型下载任务不存在。");
  }
  task.abortController.abort();
}

async function runVisualModelDownload(
  state: AppState,
  window: BrowserWindow | null,
  snapshot: VisualModelDownloadSnapshot,
  abortController: AbortController,
): Promise<void> {
  const signal = abortController.signal;
  snapshot.status = "scanning";
  emitDownloadSnapshot(window, snapshot);

  const modelInfo = await fetchModelInfo(snapshot.repoId, signal);
  const revision = modelInfo.sha || "main";
  const filenames = (modelInfo.siblings ?? [])
    .map((file) => file.rfilename)
    .filter((filename): filename is string => Boolean(filename && filename.trim()));
  if (filenames.length === 0) {
    throw new Error("模型仓库没有可下载文件。");
  }

  await fs.mkdir(snapshot.targetDir, { recursive: true });
  const files = await resolveDownloadFiles(snapshot.repoId, revision, filenames, signal);
  snapshot.totalFiles = files.length;
  snapshot.totalBytes =
    files.reduce((sum, file) => sum + file.size, 0) ||
    (Number.isFinite(modelInfo.usedStorage) ? (modelInfo.usedStorage ?? 0) : 0);
  snapshot.status = "downloading";
  emitDownloadSnapshot(window, snapshot);

  let lastEmitAt = 0;
  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmitAt < 250) {
      return;
    }
    lastEmitAt = now;
    emitDownloadSnapshot(window, snapshot);
  };

  for (const file of files) {
    signal.throwIfAborted();
    snapshot.currentFileName = file.name;
    emitProgress(true);

    const outputPath = resolveSafeOutputPath(snapshot.targetDir, file.name);
    if (file.size > 0 && fssync.existsSync(outputPath)) {
      const stats = await fs.stat(outputPath);
      if (stats.isFile() && stats.size === file.size) {
        snapshot.downloadedBytes += file.size;
        snapshot.completedFiles += 1;
        emitProgress(true);
        continue;
      }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await downloadFile(snapshot.repoId, revision, file, outputPath, signal, (bytes) => {
      snapshot.downloadedBytes += bytes;
      emitProgress();
    });
    snapshot.completedFiles += 1;
    emitProgress(true);
  }

  snapshot.status = "completed";
  snapshot.currentFileName = null;
  snapshot.error = null;
  emitDownloadSnapshot(window, snapshot);
  state.visualModelDownloadTasks.delete(snapshot.id);
}

async function fetchModelInfo(repoId: string, signal: AbortSignal): Promise<HuggingFaceModelInfo> {
  const response = await net.fetch(`${HF_MIRROR_URL}/api/models/${repoId}`, { signal });
  if (!response.ok) {
    throw new Error(`模型信息获取失败：HTTP ${response.status}`);
  }
  return (await response.json()) as HuggingFaceModelInfo;
}

async function resolveDownloadFiles(
  repoId: string,
  revision: string,
  filenames: string[],
  signal: AbortSignal,
): Promise<DownloadFile[]> {
  const files: DownloadFile[] = [];
  for (const name of filenames) {
    const size = await fetchFileSize(repoId, revision, name, signal);
    files.push({ name, size });
  }
  return files;
}

async function fetchFileSize(
  repoId: string,
  revision: string,
  filename: string,
  signal: AbortSignal,
): Promise<number> {
  try {
    const response = await net.fetch(fileUrl(repoId, revision, filename), {
      method: "HEAD",
      signal,
    });
    if (!response.ok) {
      return 0;
    }
    const contentLength = response.headers.get("content-length");
    const parsed = contentLength ? Number.parseInt(contentLength, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

async function downloadFile(
  repoId: string,
  revision: string,
  file: DownloadFile,
  outputPath: string,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
): Promise<void> {
  const response = await net.fetch(fileUrl(repoId, revision, file.name), { signal });
  if (!response.ok || !response.body) {
    throw new Error(`${file.name} 下载失败：HTTP ${response.status}`);
  }

  const temporaryPath = `${outputPath}.download`;
  const tracker = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onProgress(chunk.byteLength);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      tracker,
      fssync.createWriteStream(temporaryPath),
    );
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function fileUrl(repoId: string, revision: string, filename: string): string {
  return `${HF_MIRROR_URL}/${repoId}/resolve/${revision}/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function resolveSafeOutputPath(targetDir: string, filename: string): string {
  const normalized = path.normalize(filename);
  if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error(`模型文件路径不安全：${filename}`);
  }
  return path.join(targetDir, normalized);
}

function emitDownloadSnapshot(
  window: BrowserWindow | null,
  snapshot: VisualModelDownloadSnapshot,
): void {
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send("visual-model-download-updated", { ...snapshot });
}
