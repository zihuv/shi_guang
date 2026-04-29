import { protocol } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { isPathAllowedForRead } from "../storage";
import { getDeletedFolderHoldingDir } from "../trash-paths";
import type { AppState } from "../types";
import { getMimeTypeForExtension } from "../../src/shared/file-formats";

const tokenToPath = new Map<string, string>();
const pathToToken = new Map<string, string>();

interface ByteRange {
  start: number;
  end: number;
}

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

export function parseByteRange(rangeHeader: string | null, fileSize: number): ByteRange | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number.parseInt(rawStart, 10);
  const requestedEnd = rawEnd ? Number.parseInt(rawEnd, 10) : fileSize - 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}

async function buildFileResponse(filePath: string, request: Request): Promise<Response> {
  const stat = await fsp.stat(filePath);
  const range = parseByteRange(request.headers.get("range"), stat.size);
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000",
    "content-type": contentTypeForPath(filePath),
  });

  if (request.headers.has("range") && !range) {
    headers.set("content-range", `bytes */${stat.size}`);
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    headers.set("content-length", String(contentLength));
    headers.set("content-range", `bytes ${range.start}-${range.end}/${stat.size}`);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 206,
        headers,
      });
    }

    return new Response(
      Readable.toWeb(fs.createReadStream(filePath, { start: range.start, end: range.end })),
      {
        status: 206,
        headers,
      },
    );
  }

  headers.set("content-length", String(stat.size));

  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers,
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers,
  });
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
      await fsp.access(filePath);
      return await buildFileResponse(filePath, request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
