import { net, protocol } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPathAllowedForRead } from "./storage";
import type { AppState } from "./types";

const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

export function registerFileProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "shiguang-file",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

export function assetToUrl(filePath: string): string {
  const normalized = path.resolve(filePath);
  let token = pathToToken.get(normalized);
  if (!token) {
    token = crypto.randomUUID();
    pathToToken.set(normalized, token);
    tokenToPath.set(token, normalized);
  }
  return `shiguang-file://asset/${token}`;
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}

export function registerFileProtocol(getAppState: () => AppState | null): void {
  protocol.handle("shiguang-file", async (request) => {
    const state = getAppState();
    if (!state) {
      return new Response("App is not ready", { status: 503 });
    }

    const url = new URL(request.url);
    const token = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const filePath = tokenToPath.get(token);
    if (
      !filePath ||
      !isPathAllowedForRead(
        filePath,
        state.db
          .prepare("SELECT path FROM index_paths")
          .all()
          .map((row) => (row as { path: string }).path),
      )
    ) {
      return new Response("Not found", { status: 404 });
    }

    try {
      await fs.access(filePath);
      const response = await net.fetch(pathToFileURL(filePath).toString());
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": contentTypeForPath(filePath),
          "cache-control": "public, max-age=31536000",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
