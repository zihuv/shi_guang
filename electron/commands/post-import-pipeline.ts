import { BrowserWindow } from "electron";
import log from "electron-log/main";
import {
  getFileById,
  getIndexPaths,
  getSetting,
  updateFileColorData,
  updateFileContentHash,
  updateFileThumbHash,
} from "../database";
import {
  buildThumbHash,
  canAnalyzeImage,
  canBackendDecodeImage,
  computeVisualContentHash,
  extractColorDistributionFromInput,
} from "../media";
import { hasThumbnailCachePath, getOrCreateThumbnail } from "../storage";
import { decideThumbnailPlan } from "../thumbnail";
import type { AppState, FileRecord } from "../types";
import { emit } from "./common";
import { AutoAiMetadataScheduler } from "./auto-ai-metadata-scheduler";
import {
  hasEnabledAiMetadataAnalysisFields,
  maybeAutoIndexImportedFile,
  startAiMetadataTask,
} from "./visual-ai-service";

const AUTO_AI_METADATA_DEBOUNCE_MS = 800;

let postImportPipelineQueue = Promise.resolve();

export type PostImportSource = "import_task" | "collector" | "restore" | "library_sync";

export interface PostImportContext {
  source: PostImportSource;
  notify?: boolean;
  enrich?: boolean;
  autoAnalyzeMetadata?: boolean;
  autoVisualIndex?: boolean;
}

const autoAiMetadataScheduler = new AutoAiMetadataScheduler({
  debounceMs: AUTO_AI_METADATA_DEBOUNCE_MS,
  setTimeout,
  clearTimeout,
  canAnalyzeFile: (file) => canAnalyzeImage(file.ext),
  shouldStart: shouldAutoAnalyzeImportedMetadata,
  startTask: startAiMetadataTask,
  logWarn: (message, details) => log.warn(message, details),
});

export function shouldGenerateFileThumbnail(
  file: Pick<FileRecord, "ext" | "width" | "height" | "size">,
) {
  return decideThumbnailPlan({
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
  }).shouldGenerate;
}

export async function ensureThumbnailForFile(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
  options: {
    allowBackgroundRequest?: boolean;
  } = {},
): Promise<string | null> {
  const file = getFileById(state.db, fileId);
  if (!file) {
    return null;
  }

  const thumbnailPlan = decideThumbnailPlan({
    ext: file.ext,
    width: file.width,
    height: file.height,
    size: file.size,
  });
  if (!thumbnailPlan.shouldGenerate) {
    return null;
  }

  const existingThumbnailPath = hasThumbnailCachePath(
    getIndexPaths(state.db),
    file.path,
    file.contentHash,
  );
  if (existingThumbnailPath) {
    return existingThumbnailPath;
  }

  if (thumbnailPlan.runtime === "renderer") {
    if (options.allowBackgroundRequest !== false && window) {
      emit(window, "thumbnail-build-request", {
        fileId: file.id,
        path: file.path,
        ext: file.ext,
        reason: thumbnailPlan.reason,
        runtime: thumbnailPlan.runtime,
      });
    }
    return null;
  }

  if (thumbnailPlan.runtime !== "main") {
    return null;
  }

  const thumbnailPath = await getOrCreateThumbnail(getIndexPaths(state.db), {
    filePath: file.path,
    ext: file.ext,
    contentHash: file.contentHash,
  });

  if (thumbnailPath) {
    emit(window, "file-updated", { fileId: file.id });
    return thumbnailPath;
  }

  return null;
}

function shouldNotifyImport(context: PostImportContext): boolean {
  return context.notify ?? context.source !== "library_sync";
}

function shouldEnrichImportedFile(context: PostImportContext): boolean {
  return context.enrich ?? true;
}

function shouldAutoVisualIndexForContext(context: PostImportContext): boolean {
  return context.autoVisualIndex ?? true;
}

async function enrichImportedFileVisualMetadata(
  state: AppState,
  window: BrowserWindow | null,
  fileId: number,
): Promise<FileRecord | null> {
  let file = getFileById(state.db, fileId);
  if (!file) {
    return null;
  }
  if (!canBackendDecodeImage(file.ext)) {
    return file;
  }

  let changed = false;

  if (!file.contentHash) {
    const contentHash = await computeVisualContentHash(file.path);
    if (contentHash) {
      updateFileContentHash(state.db, file.id, contentHash);
      changed = true;
    }
  }

  if (!file.colorDistribution || file.colorDistribution === "[]") {
    const colors = await extractColorDistributionFromInput(file.path);
    if (colors.length > 0) {
      updateFileColorData(state.db, file.id, colors[0]?.color ?? "", JSON.stringify(colors));
      changed = true;
    }
  }

  if (!file.thumbHash) {
    const thumbHash = await buildThumbHash(file.path, file.ext);
    if (thumbHash) {
      updateFileThumbHash(state.db, file.id, thumbHash);
      changed = true;
    }
  }

  if (changed) {
    emit(window, "file-updated", { fileId: file.id });
    file = getFileById(state.db, fileId);
  }

  return file;
}

function shouldAutoAnalyzeImportedMetadata(state: AppState): boolean {
  const value = getSetting(state.db, "aiAutoAnalyzeOnImport");
  if (value !== "true" && value !== "1") {
    return false;
  }
  return hasEnabledAiMetadataAnalysisFields(state);
}

async function runPostImportEnhancementPipeline(
  state: AppState,
  window: BrowserWindow | null,
  file: FileRecord,
  context: PostImportContext,
): Promise<void> {
  const enrichedFile = shouldEnrichImportedFile(context)
    ? await enrichImportedFileVisualMetadata(state, window, file.id)
    : getFileById(state.db, file.id);

  const currentFile = enrichedFile ?? file;
  await ensureThumbnailForFile(state, window, currentFile.id);

  if (shouldAutoVisualIndexForContext(context)) {
    await maybeAutoIndexImportedFile(state, currentFile, window);
  }
}

export function runPostImportPipeline(
  state: AppState,
  window: BrowserWindow | null,
  file: FileRecord,
  context: PostImportContext,
): void {
  if (shouldNotifyImport(context)) {
    emit(window, "file-imported", { file_id: file.id, path: file.path });
    emit(window, "file-updated", { fileId: file.id });
  }

  autoAiMetadataScheduler.schedule(state, window, file, context);

  postImportPipelineQueue = postImportPipelineQueue
    .then(() => runPostImportEnhancementPipeline(state, window, file, context))
    .catch((error) => {
      log.warn("[import] post-import pipeline failed", {
        fileId: file.id,
        source: context.source,
        error,
      });
    });
}
