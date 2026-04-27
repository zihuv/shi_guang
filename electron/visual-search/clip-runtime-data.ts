import fs from "node:fs/promises";
import { SUPPORTED_FGCLIP_PATCH_BUCKETS } from "./clip-image-preprocess.js";

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(embedding.length * 4);
  for (let index = 0; index < embedding.length; index += 1) {
    buffer.writeFloatLE(embedding[index], index * 4);
  }
  return buffer;
}

export function resolveFgClipMaxPatches(
  manifestDefaultMaxPatches: number,
  runtimeOverride: number | null,
): number {
  if (runtimeOverride == null) {
    return manifestDefaultMaxPatches;
  }
  if (!SUPPORTED_FGCLIP_PATCH_BUCKETS.includes(runtimeOverride)) {
    throw new Error(
      `fgclipMaxPatches 必须是 ${SUPPORTED_FGCLIP_PATCH_BUCKETS.join("、")} 之一，当前为 ${runtimeOverride}。`,
    );
  }
  if (runtimeOverride > manifestDefaultMaxPatches) {
    throw new Error(
      `fgclipMaxPatches ${runtimeOverride} 不能大于模型 default_max_patches ${manifestDefaultMaxPatches}。`,
    );
  }
  return runtimeOverride;
}

export async function resolveTokenEmbeddingRows(
  filePath: string,
  dtype: "f16" | "f32",
  embeddingDim: number,
): Promise<number> {
  const stats = await fs.stat(filePath);
  const rowBytes = (dtype === "f16" ? 2 : 4) * embeddingDim;
  if (stats.size % rowBytes !== 0) {
    throw new Error(`fg_clip token embedding 文件长度异常：${stats.size} bytes。`);
  }
  return stats.size / rowBytes;
}

export async function readF32File(filePath: string): Promise<Float32Array> {
  const bytes = await fs.readFile(filePath);
  if (bytes.length % 4 !== 0) {
    throw new Error(`${filePath} 的字节数不能被 4 整除。`);
  }
  const values = new Float32Array(bytes.length / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = bytes.readFloatLE(index * 4);
  }
  return values;
}
