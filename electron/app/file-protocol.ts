import { net, protocol } from "electron";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPathAllowedForRead } from "../storage";
import { getDeletedFolderHoldingDir } from "../trash-paths";
import type { AppState } from "../types";
import { getMimeTypeForExtension } from "../../src/shared/file-formats";

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
  return getMimeTypeForExtension(path.extname(filePath));
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
        [getDeletedFolderHoldingDir(state.appDataDir)],
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
