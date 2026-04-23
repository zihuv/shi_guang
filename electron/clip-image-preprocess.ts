import sharp from "sharp";
import type { FlatManifest } from "./clip-manifest.js";

export type FgClipImageRuntime = {
  tokenEmbeddingDim: number;
  defaultMaxPatches: number;
  patchSize: number;
  basePosEmbedding: Float32Array;
  baseGridHeight: number;
  baseGridWidth: number;
};

export type FgClipImageInputs = {
  pixelValues: Float32Array;
  pixelAttentionMask: Int32Array;
  posEmbed: Float32Array;
  maxPatches: number;
  channels: number;
};

export const SUPPORTED_FGCLIP_PATCH_BUCKETS = [128, 256, 576, 784, 1024];

export async function preprocessChineseClipImage(
  filePath: string,
  manifest: FlatManifest,
): Promise<Float32Array> {
  const preprocess = manifest.image.preprocess;
  if (preprocess.kind !== "clip_image") {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }

  const imageSize = preprocess.image_size;
  if (
    !imageSize ||
    !Array.isArray(preprocess.mean) ||
    !Array.isArray(preprocess.std) ||
    preprocess.mean.length !== 3 ||
    preprocess.std.length !== 3
  ) {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }
  const cropMode = preprocess.crop ?? "none";
  const pipeline = sharp(filePath, { animated: false }).rotate().removeAlpha();
  const resized =
    cropMode === "center"
      ? pipeline.resize(imageSize, imageSize, {
          fit: "cover",
          position: "centre",
        })
      : pipeline.resize(imageSize, imageSize, {
          fit: "fill",
        });

  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  if (info.channels < 3) {
    throw new Error("图像预处理失败：通道数不足。");
  }

  const tensor = new Float32Array(1 * 3 * imageSize * imageSize);
  const planeSize = imageSize * imageSize;
  for (let y = 0; y < imageSize; y += 1) {
    for (let x = 0; x < imageSize; x += 1) {
      const pixelIndex = (y * imageSize + x) * info.channels;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[pixelIndex + channel] / 255;
        tensor[channel * planeSize + y * imageSize + x] =
          (value - preprocess.mean[channel]) / preprocess.std[channel];
      }
    }
  }
  return tensor;
}

function determineFgClipMaxPatches(
  width: number,
  height: number,
  patchSize: number,
  defaultMaxPatches: number,
): number {
  const raw = Math.floor(width / patchSize) * Math.floor(height / patchSize);
  const buckets = [
    ...SUPPORTED_FGCLIP_PATCH_BUCKETS.filter((item) => item <= defaultMaxPatches),
    defaultMaxPatches,
  ]
    .sort((left, right) => left - right)
    .filter((item, index, values) => index === 0 || item !== values[index - 1]);
  return buckets.find((candidate) => raw <= candidate) ?? defaultMaxPatches;
}

function scaledPatchSize(scale: number, size: number, patchSize: number): number {
  const scaled = size * scale;
  return Math.max(patchSize, Math.ceil(scaled / patchSize) * patchSize);
}

function getFgClipImageSizeForMaxPatches(
  imageHeight: number,
  imageWidth: number,
  patchSize: number,
  maxPatches: number,
): { targetHeight: number; targetWidth: number } {
  const eps = 1e-5;
  let scaleMin = eps / 10;
  let scaleMax = 100;
  while (scaleMax - scaleMin >= eps) {
    const scale = (scaleMin + scaleMax) / 2;
    const targetHeight = scaledPatchSize(scale, imageHeight, patchSize);
    const targetWidth = scaledPatchSize(scale, imageWidth, patchSize);
    const patchCount = (targetHeight / patchSize) * (targetWidth / patchSize);
    if (patchCount <= maxPatches) {
      scaleMin = scale;
    } else {
      scaleMax = scale;
    }
  }
  return {
    targetHeight: scaledPatchSize(scaleMin, imageHeight, patchSize),
    targetWidth: scaledPatchSize(scaleMin, imageWidth, patchSize),
  };
}

function linearSourceCoordinate(
  outputIndex: number,
  outputSize: number,
  inputSize: number,
): number {
  const source = ((outputIndex + 0.5) * inputSize) / outputSize - 0.5;
  return Math.max(0, Math.min(inputSize - 1, source));
}

function lerp(left: number, right: number, weight: number): number {
  return left + (right - left) * weight;
}

function buildFgClipPositionalEmbedding(
  runtime: FgClipImageRuntime,
  targetHeight: number,
  targetWidth: number,
  maxPatches: number,
): Float32Array {
  const channels = runtime.tokenEmbeddingDim;
  const output = new Float32Array(maxPatches * channels);
  for (let outY = 0; outY < targetHeight; outY += 1) {
    const inY = linearSourceCoordinate(outY, targetHeight, runtime.baseGridHeight);
    const y0 = Math.max(0, Math.min(runtime.baseGridHeight - 1, Math.floor(inY)));
    const y1 = Math.min(y0 + 1, runtime.baseGridHeight - 1);
    const wy = inY - y0;

    for (let outX = 0; outX < targetWidth; outX += 1) {
      const inX = linearSourceCoordinate(outX, targetWidth, runtime.baseGridWidth);
      const x0 = Math.max(0, Math.min(runtime.baseGridWidth - 1, Math.floor(inX)));
      const x1 = Math.min(x0 + 1, runtime.baseGridWidth - 1);
      const wx = inX - x0;
      const token = outY * targetWidth + outX;

      for (let channel = 0; channel < channels; channel += 1) {
        const top = lerp(
          runtime.basePosEmbedding[(y0 * runtime.baseGridWidth + x0) * channels + channel],
          runtime.basePosEmbedding[(y0 * runtime.baseGridWidth + x1) * channels + channel],
          wx,
        );
        const bottom = lerp(
          runtime.basePosEmbedding[(y1 * runtime.baseGridWidth + x0) * channels + channel],
          runtime.basePosEmbedding[(y1 * runtime.baseGridWidth + x1) * channels + channel],
          wx,
        );
        output[token * channels + channel] = lerp(top, bottom, wy);
      }
    }
  }

  const valid = targetHeight * targetWidth;
  if (valid > 0 && valid < maxPatches) {
    const first = output.slice(0, channels);
    for (let token = valid; token < maxPatches; token += 1) {
      output.set(first, token * channels);
    }
  }

  return output;
}

export async function preprocessFgClipImage(
  filePath: string,
  runtime: FgClipImageRuntime,
): Promise<FgClipImageInputs> {
  const metadata = await sharp(filePath, { animated: false }).rotate().metadata();
  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error("图像预处理失败：无法读取图片尺寸。");
  }

  const maxPatches = determineFgClipMaxPatches(
    originalWidth,
    originalHeight,
    runtime.patchSize,
    runtime.defaultMaxPatches,
  );
  const { targetHeight, targetWidth } = getFgClipImageSizeForMaxPatches(
    originalHeight,
    originalWidth,
    runtime.patchSize,
    maxPatches,
  );
  const { data, info } = await sharp(filePath, { animated: false })
    .rotate()
    .removeAlpha()
    .resize(targetWidth, targetHeight, {
      fit: "fill",
      kernel: "linear",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 3) {
    throw new Error("图像预处理失败：通道数不足。");
  }

  const spatialHeight = targetHeight / runtime.patchSize;
  const spatialWidth = targetWidth / runtime.patchSize;
  const validPatches = spatialHeight * spatialWidth;
  const channels = runtime.patchSize * runtime.patchSize * 3;
  if (validPatches > maxPatches) {
    throw new Error(`fg_clip patch 数异常：${validPatches} > ${maxPatches}。`);
  }

  const pixelValues = new Float32Array(maxPatches * channels);
  for (let patchY = 0; patchY < spatialHeight; patchY += 1) {
    for (let patchX = 0; patchX < spatialWidth; patchX += 1) {
      const patchIndex = patchY * spatialWidth + patchX;
      let dst = patchIndex * channels;
      for (let y = 0; y < runtime.patchSize; y += 1) {
        for (let x = 0; x < runtime.patchSize; x += 1) {
          const pixelIndex =
            ((patchY * runtime.patchSize + y) * targetWidth + (patchX * runtime.patchSize + x)) *
            info.channels;
          for (let channel = 0; channel < 3; channel += 1) {
            pixelValues[dst] = data[pixelIndex + channel] / 127.5 - 1;
            dst += 1;
          }
        }
      }
    }
  }

  const pixelAttentionMask = new Int32Array(maxPatches);
  pixelAttentionMask.fill(0);
  for (let index = 0; index < validPatches; index += 1) {
    pixelAttentionMask[index] = 1;
  }

  return {
    pixelValues,
    pixelAttentionMask,
    posEmbed: buildFgClipPositionalEmbedding(runtime, spatialHeight, spatialWidth, maxPatches),
    maxPatches,
    channels,
  };
}
