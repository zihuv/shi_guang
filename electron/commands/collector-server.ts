import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { net } from "electron";
import fssync from "node:fs";
import path from "node:path";
import {
  BROWSER_COLLECTION_FOLDER_NAME,
  BROWSER_COLLECTION_FOLDER_SORT_ORDER,
  createFolderRecord,
  getAllFolders,
  getFolderById,
  getFolderByPath,
  getFolderTree,
  getIndexPaths,
} from "../database";
import { detectExtensionFromBytes } from "../media";
import type { AppState, FolderRecord } from "../types";
import { emit, type GetWindow } from "./common";
import { importBytes, normalizeImportExtension, postImport } from "./import-service";

let collectorServer: FastifyInstance | null = null;
const COLLECTOR_IMPORT_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

type CollectorFolderTargetPayload = {
  folder_id?: unknown;
  folderId?: unknown;
  target_folder_id?: unknown;
  targetFolderId?: unknown;
};

type CollectorImportFromUrlPayload = CollectorFolderTargetPayload & {
  image_url?: string;
  referer?: string;
};

export function ensureBrowserCollectionFolder(state: AppState): FolderRecord {
  const existing = getAllFolders(state.db).find(
    (folder) => folder.isSystem && folder.name === BROWSER_COLLECTION_FOLDER_NAME,
  );
  if (existing) {
    if (existing.sortOrder !== BROWSER_COLLECTION_FOLDER_SORT_ORDER) {
      state.db
        .prepare("UPDATE folders SET sort_order = ? WHERE id = ?")
        .run(BROWSER_COLLECTION_FOLDER_SORT_ORDER, existing.id);
      return { ...existing, sortOrder: BROWSER_COLLECTION_FOLDER_SORT_ORDER };
    }
    return existing;
  }

  const folderPath = path.join(
    getIndexPaths(state.db)[0] ?? state.indexPath,
    BROWSER_COLLECTION_FOLDER_NAME,
  );
  fssync.mkdirSync(folderPath, { recursive: true });
  const pathExisting = getFolderByPath(state.db, folderPath);
  if (pathExisting) {
    state.db
      .prepare("UPDATE folders SET is_system = 1, parent_id = NULL, sort_order = ? WHERE id = ?")
      .run(BROWSER_COLLECTION_FOLDER_SORT_ORDER, pathExisting.id);
    return {
      ...pathExisting,
      isSystem: true,
      parent_id: null,
      sortOrder: BROWSER_COLLECTION_FOLDER_SORT_ORDER,
    };
  }

  const id = createFolderRecord(
    state.db,
    folderPath,
    BROWSER_COLLECTION_FOLDER_NAME,
    null,
    true,
    BROWSER_COLLECTION_FOLDER_SORT_ORDER,
  );
  return getFolderById(state.db, id) as FolderRecord;
}

function normalizeFolderId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const folderId = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(folderId) && folderId > 0 ? folderId : null;
}

function getRequestedFolderId(request: { query?: unknown; body?: unknown }): number | null {
  const query = request.query as CollectorFolderTargetPayload | undefined;
  const body = request.body as CollectorFolderTargetPayload | undefined;
  return normalizeFolderId(
    query?.folder_id ??
      query?.folderId ??
      query?.target_folder_id ??
      query?.targetFolderId ??
      body?.folder_id ??
      body?.folderId ??
      body?.target_folder_id ??
      body?.targetFolderId,
  );
}

function resolveCollectorTargetFolder(state: AppState, folderId: number | null): FolderRecord {
  if (folderId !== null) {
    const folder = getFolderById(state.db, folderId);
    if (!folder) {
      throw new Error("目标文件夹不存在");
    }
    return folder;
  }

  return ensureBrowserCollectionFolder(state);
}

function getDownloadErrorMessage(error: unknown, imageUrl: string): string {
  let host = "";
  try {
    host = new URL(imageUrl).host;
  } catch {
    host = imageUrl;
  }

  const detail = getErrorDetails(error);
  return `拾光应用无法下载图片（${host}）：${detail || "网络请求失败"}。请检查图片链接是否仍可访问，或站点是否限制外部下载。`;
}

function getErrorDetails(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details = [error.message];
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    details.push(cause.message);
  } else if (cause && typeof cause === "object") {
    const causeRecord = cause as Record<string, unknown>;
    const code = typeof causeRecord.code === "string" ? causeRecord.code : "";
    const message = typeof causeRecord.message === "string" ? causeRecord.message : "";
    if (code || message) {
      details.push([code, message].filter(Boolean).join(": "));
    }
  } else if (typeof cause === "string") {
    details.push(cause);
  }

  return [...new Set(details.filter(Boolean))].join(" / ");
}

function buildImageDownloadHeaders(imageUrl: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let imageHost = "";

  try {
    imageHost = new URL(imageUrl).host;
  } catch {
    imageHost = "";
  }

  if (imageHost.endsWith("pximg.net")) {
    headers.Referer = "https://www.pixiv.net/";
    return headers;
  }

  if (referer) {
    headers.Referer = referer;
  }

  return headers;
}

export async function startCollectorServer(state: AppState, getWindow: GetWindow): Promise<void> {
  if (collectorServer) return;
  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  server.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  server.get("/api/health", async () => ({ status: "ok" }));
  server.get("/api/folders", async () => {
    const defaultFolder = ensureBrowserCollectionFolder(state);
    return {
      success: true,
      folders: getFolderTree(state.db),
      default_folder_id: defaultFolder.id,
    };
  });
  server.options("/api/health", async () => ({}));
  server.options("/api/folders", async () => ({}));
  server.options("/api/import", async () => ({}));
  server.options("/api/import-from-url", async () => ({}));
  server.post("/api/import", { bodyLimit: COLLECTOR_IMPORT_BODY_LIMIT_BYTES }, async (request) => {
    const body = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body as ArrayBuffer);
    try {
      const folder = resolveCollectorTargetFolder(state, getRequestedFolderId(request));
      const query = request.query as { filename?: string };
      const filename = typeof query.filename === "string" ? query.filename : "";
      const headerContentType = request.headers["content-type"];
      const contentType = Array.isArray(headerContentType)
        ? headerContentType[0]
        : headerContentType;
      const file = await importBytes(state, {
        bytes: body,
        folderId: folder.id,
        fallbackExt: normalizeImportExtension(
          detectExtensionFromBytes(body, contentType) ?? path.extname(filename),
        ),
        namePrefix: "browser",
      });
      postImport(state, getWindow(), file);
      return { success: true, file_id: file.id, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit(getWindow(), "file-import-error", { error: message });
      return { success: false, file_id: null, error: message };
    }
  });
  server.post("/api/import-from-url", async (request) => {
    const payload = request.body as CollectorImportFromUrlPayload;
    if (!payload?.image_url) return { success: false, file_id: null, error: "Missing image_url" };
    try {
      let response: Awaited<ReturnType<typeof net.fetch>>;
      const downloadHeaders = buildImageDownloadHeaders(payload.image_url, payload.referer);
      try {
        response = await net.fetch(payload.image_url, {
          headers: downloadHeaders,
        });
      } catch (error) {
        throw new Error(getDownloadErrorMessage(error, payload.image_url));
      }
      if (!response.ok) {
        throw new Error(
          `拾光应用下载图片失败：${response.status} ${response.statusText || ""}`.trim(),
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const folder = resolveCollectorTargetFolder(state, getRequestedFolderId(request));
      const contentType = response.headers.get("content-type");
      const file = await importBytes(state, {
        bytes,
        folderId: folder.id,
        fallbackExt: normalizeImportExtension(detectExtensionFromBytes(bytes, contentType)),
        namePrefix: "browser",
        sourceUrl: payload.referer ?? payload.image_url,
      });
      postImport(state, getWindow(), file);
      return { success: true, file_id: file.id, error: null };
    } catch (error) {
      return {
        success: false,
        file_id: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  await server.listen({ host: "127.0.0.1", port: 7845 });
  collectorServer = server;
}
