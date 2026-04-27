import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";
import { rgbaToThumbHash, thumbHashBytesToBase64 } from "../src/lib/thumbhash";
import {
  AI_SUPPORTED_IMAGE_EXTENSIONS as AI_SUPPORTED_IMAGE_EXTENSION_LIST,
  BACKEND_DECODABLE_IMAGE_EXTENSIONS as BACKEND_DECODABLE_IMAGE_EXTENSION_LIST,
  BLOCKED_UNSUPPORTED_EXTENSIONS as BLOCKED_UNSUPPORTED_EXTENSION_LIST,
  SCAN_SUPPORTED_EXTENSIONS as SCAN_SUPPORTED_EXTENSION_LIST,
  extensionSet,
} from "../src/shared/file-formats";

const PROBE_READ_LIMIT = 4096;

export const BLOCKED_UNSUPPORTED_EXTENSIONS = extensionSet(BLOCKED_UNSUPPORTED_EXTENSION_LIST);
export const SCAN_SUPPORTED_EXTENSIONS = extensionSet(SCAN_SUPPORTED_EXTENSION_LIST);
export const BACKEND_DECODABLE_IMAGE_EXTENSIONS = extensionSet(
  BACKEND_DECODABLE_IMAGE_EXTENSION_LIST,
);
export const AI_SUPPORTED_IMAGE_EXTENSIONS = extensionSet(AI_SUPPORTED_IMAGE_EXTENSION_LIST);

function asciiSlice(bytes: Buffer, start: number, end: number): string {
  if (bytes.length < end) {
    return "";
  }
  return bytes.subarray(start, end).toString("latin1");
}

function hasSignature(bytes: Buffer, signature: number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value)
  );
}

function normalizeContentType(contentType?: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionFromContentType(contentType?: string | null): string | null {
  const normalized = normalizeContentType(contentType);
  const map: Record<string, string> = {
    "image/png": "png",
    "image/apng": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/jfif": "jpg",
    "image/pjpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-ms-bmp": "bmp",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "image/tiff": "tiff",
    "image/tif": "tiff",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
    "video/x-ms-wmv": "wmv",
    "video/x-flv": "flv",
    "video/3gpp": "3gp",
    "video/3gpp2": "3g2",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "text/plain": "txt",
    "text/csv": "csv",
    "text/html": "html",
    "image/vnd.adobe.photoshop": "psd",
  };
  return map[normalized] ?? null;
}

function bmffBrands(bytes: Buffer): string {
  return asciiSlice(bytes, 4, 8) === "ftyp"
    ? bytes.subarray(8, Math.min(bytes.length, 64)).toString("latin1").toLowerCase()
    : "";
}

export function detectExtensionFromBytes(
  bytes: Buffer,
  contentType?: string | null,
): string | null {
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (asciiSlice(bytes, 0, 4) === "GIF8") return "gif";
  if (asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "WEBP") return "webp";
  if (asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 12) === "AVI ") return "avi";
  if (hasSignature(bytes, [0x42, 0x4d])) return "bmp";
  if (
    hasSignature(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    hasSignature(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "tiff";
  }
  if (hasSignature(bytes, [0x00, 0x00, 0x01, 0x00])) return "ico";

  const brands = bmffBrands(bytes);
  if (brands) {
    if (brands.includes("avif") || brands.includes("avis")) return "avif";
    if (["heic", "heix", "hevc", "hevx"].some((brand) => brands.includes(brand))) return "heic";
    if (
      ["mif1", "msf1", "heif", "heis", "heim", "hevm", "hevs"].some((brand) =>
        brands.includes(brand),
      )
    )
      return "heif";
    if (brands.includes("qt  ")) return "mov";
    if (brands.includes("m4v")) return "m4v";
    if (brands.includes("3g2")) return "3g2";
    if (["3gp", "3gr", "3gs"].some((brand) => brands.includes(brand))) return "3gp";
    if (
      ["mp4", "isom", "iso2", "iso5", "iso6", "avc1", "dash"].some((brand) =>
        brands.includes(brand),
      )
    )
      return "mp4";
  }

  if (
    hasSignature(
      bytes,
      [
        0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce,
        0x6c,
      ],
    )
  ) {
    return "wmv";
  }
  if (asciiSlice(bytes, 0, 3) === "FLV") return "flv";
  if (hasSignature(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = bytes
      .subarray(0, Math.min(bytes.length, PROBE_READ_LIMIT))
      .toString("latin1")
      .toLowerCase();
    if (head.includes("webm")) return "webm";
    if (head.includes("matroska")) return "mkv";
  }
  if (asciiSlice(bytes, 0, 4) === "8BPS") return "psd";

  const textHead = bytes
    .subarray(0, Math.min(bytes.length, PROBE_READ_LIMIT))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  if (textHead.startsWith("%pdf-")) return "pdf";
  if (textHead.startsWith("<svg") || textHead.startsWith("<?xml")) return "svg";

  return extensionFromContentType(contentType);
}

export async function detectExtensionFromPath(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(PROBE_READ_LIMIT);
    const { bytesRead } = await handle.read(buffer, 0, PROBE_READ_LIMIT, 0);
    return detectExtensionFromBytes(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function isScanSupportedExtension(ext: string): boolean {
  return SCAN_SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

export function isBlockedUnsupportedExtension(ext: string): boolean {
  return BLOCKED_UNSUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

export function canBackendDecodeImage(ext: string): boolean {
  return BACKEND_DECODABLE_IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function canAnalyzeImage(ext: string): boolean {
  return AI_SUPPORTED_IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export async function getImageDimensions(
  filePath: string,
  ext: string,
): Promise<{ width: number; height: number }> {
  if (!canBackendDecodeImage(ext)) {
    return { width: 0, height: 0 };
  }

  try {
    const metadata = await sharp(filePath, { animated: false }).metadata();
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function buildThumbHash(filePath: string, ext: string): Promise<string> {
  if (!canBackendDecodeImage(ext)) {
    return "";
  }

  try {
    const image = await sharp(filePath, { animated: false })
      .rotate()
      .resize(100, 100, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (!image.info.width || !image.info.height || image.data.length === 0) {
      return "";
    }

    return thumbHashBytesToBase64(
      rgbaToThumbHash(image.info.width, image.info.height, new Uint8Array(image.data)),
    );
  } catch {
    return "";
  }
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("")}`;
}

function colorDistance(left: number[], right: number[]): number {
  const dr = left[0] - right[0];
  const dg = left[1] - right[1];
  const db = left[2] - right[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export async function extractColorDistributionFromInput(
  input: string | Buffer,
): Promise<Array<{ color: string; percentage: number }>> {
  let image;
  try {
    image = await sharp(input, { animated: false })
      .rotate()
      .resize(50, 50, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return [];
  }

  const pixels: number[][] = [];
  for (let index = 0; index + 2 < image.data.length; index += image.info.channels) {
    pixels.push([image.data[index], image.data[index + 1], image.data[index + 2]]);
  }

  if (!pixels.length) {
    return [];
  }

  const centroidCount = Math.min(7, pixels.length);
  const centroids = pixels.slice(0, centroidCount).map((pixel) => [...pixel]);

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const clusters = Array.from({ length: centroidCount }, () => [] as number[][]);
    for (const pixel of pixels) {
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = colorDistance(pixel, centroid);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      clusters[nearest].push(pixel);
    }

    let changed = false;
    clusters.forEach((cluster, index) => {
      if (!cluster.length) {
        return;
      }
      const next = [
        cluster.reduce((sum, pixel) => sum + pixel[0], 0) / cluster.length,
        cluster.reduce((sum, pixel) => sum + pixel[1], 0) / cluster.length,
        cluster.reduce((sum, pixel) => sum + pixel[2], 0) / cluster.length,
      ];
      if (colorDistance(next, centroids[index]) > 1) {
        changed = true;
      }
      centroids[index] = next;
    });

    if (!changed) {
      break;
    }
  }

  const counts = Array.from({ length: centroidCount }, () => 0);
  for (const pixel of pixels) {
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    centroids.forEach((centroid, index) => {
      const distance = colorDistance(pixel, centroid);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    counts[nearest] += 1;
  }

  const colors = centroids
    .map((centroid, index) => ({
      color: toHex(centroid[0], centroid[1], centroid[2]),
      percentage: (counts[index] / pixels.length) * 100,
    }))
    .filter((entry) => entry.percentage > 0)
    .sort((left, right) => right.percentage - left.percentage);

  const merged: Array<{ color: string; percentage: number; rgb: number[] }> = [];
  for (const entry of colors) {
    const rgb = [
      Number.parseInt(entry.color.slice(1, 3), 16),
      Number.parseInt(entry.color.slice(3, 5), 16),
      Number.parseInt(entry.color.slice(5, 7), 16),
    ];
    const similar = merged.find((item) => colorDistance(item.rgb, rgb) < 30);
    if (similar) {
      similar.percentage += entry.percentage;
    } else {
      merged.push({ ...entry, rgb });
    }
  }

  return merged
    .sort((left, right) => right.percentage - left.percentage)
    .slice(0, 7)
    .map(({ color, percentage }) => ({ color, percentage }));
}

export async function computeVisualContentHash(input: string | Buffer): Promise<string | null> {
  try {
    const image = await sharp(input, { animated: false })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hasher = crypto.createHash("sha256");
    const width = Buffer.alloc(4);
    const height = Buffer.alloc(4);
    width.writeUInt32LE(image.info.width);
    height.writeUInt32LE(image.info.height);
    hasher.update(width);
    hasher.update(height);
    hasher.update(image.data);
    return hasher.digest("hex");
  } catch {
    return null;
  }
}
