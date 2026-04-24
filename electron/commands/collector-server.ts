import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fssync from "node:fs";
import path from "node:path";
import {
  BROWSER_COLLECTION_FOLDER_NAME,
  BROWSER_COLLECTION_FOLDER_SORT_ORDER,
  createFolderRecord,
  getAllFolders,
  getFolderById,
  getFolderByPath,
  getIndexPaths,
} from "../database";
import { detectExtensionFromBytes } from "../media";
import type { AppState, FolderRecord } from "../types";
import { emit, type GetWindow } from "./common";
import { importBytes, normalizeImportExtension, postImport } from "./import-service";

let collectorServer: FastifyInstance | null = null;

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

export async function startCollectorServer(state: AppState, getWindow: GetWindow): Promise<void> {
  if (collectorServer) return;
  const server = Fastify({ logger: false });
  await server.register(cors, { origin: true });
  server.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  server.get("/api/health", async () => ({ status: "ok" }));
  server.options("/api/health", async () => ({}));
  server.options("/api/import", async () => ({}));
  server.options("/api/import-from-url", async () => ({}));
  server.post("/api/import", async (request) => {
    const body = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body as ArrayBuffer);
    const folder = ensureBrowserCollectionFolder(state);
    try {
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
    const payload = request.body as { image_url?: string; referer?: string };
    if (!payload?.image_url) return { success: false, file_id: null, error: "Missing image_url" };
    try {
      const response = await fetch(payload.image_url, {
        headers: payload.referer ? { referer: payload.referer } : undefined,
      });
      if (!response.ok) throw new Error(`Download failed with status: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const folder = ensureBrowserCollectionFolder(state);
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
