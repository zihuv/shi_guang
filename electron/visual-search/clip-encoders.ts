import fs from "node:fs/promises";
import * as ort from "onnxruntime-node";
import { preprocessChineseClipImage, preprocessFgClipImage } from "./clip-image-preprocess.js";
import type {
  ChineseClipTextRuntime,
  FgClipImageRuntimeHandle,
  FgClipTextRuntime,
  ResolvedClipModel,
} from "./clip-runtime-model.js";

function f16ToF32(bits: number): number {
  const sign = (bits & 0x8000) << 16;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  let f32Bits: number;

  if (exponent === 0 && fraction === 0) {
    f32Bits = sign;
  } else if (exponent === 0) {
    let normalizedFraction = fraction;
    let normalizedExponent = -14;
    while ((normalizedFraction & 0x0400) === 0) {
      normalizedFraction <<= 1;
      normalizedExponent -= 1;
    }
    normalizedFraction &= 0x03ff;
    f32Bits = sign | ((normalizedExponent + 127) << 23) | (normalizedFraction << 13);
  } else if (exponent === 0x1f) {
    f32Bits = sign | 0x7f800000 | (fraction << 13);
  } else {
    f32Bits = sign | ((exponent + 112) << 23) | (fraction << 13);
  }

  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, f32Bits, true);
  return new DataView(buffer).getFloat32(0, true);
}

async function gatherTokenEmbeddingRows(
  runtime: FgClipTextRuntime,
  inputIds: Int32Array,
): Promise<Float32Array> {
  const rowBytes = (runtime.tokenEmbeddingDtype === "f16" ? 2 : 4) * runtime.tokenEmbeddingDim;
  const values = new Float32Array(inputIds.length * runtime.tokenEmbeddingDim);
  const handle = await fs.open(runtime.tokenEmbeddingPath, "r");

  try {
    const row = Buffer.allocUnsafe(rowBytes);
    for (let tokenIndex = 0; tokenIndex < inputIds.length; tokenIndex += 1) {
      const tokenId = inputIds[tokenIndex];
      if (tokenId < 0 || tokenId >= runtime.tokenEmbeddingRows) {
        throw new Error(
          `token id ${tokenId} 超出 fg_clip embedding 表范围 ${runtime.tokenEmbeddingRows}。`,
        );
      }

      await handle.read(row, 0, rowBytes, tokenId * rowBytes);
      const outputOffset = tokenIndex * runtime.tokenEmbeddingDim;
      if (runtime.tokenEmbeddingDtype === "f16") {
        for (let index = 0; index < runtime.tokenEmbeddingDim; index += 1) {
          values[outputOffset + index] = f16ToF32(row.readUInt16LE(index * 2));
        }
      } else {
        for (let index = 0; index < runtime.tokenEmbeddingDim; index += 1) {
          values[outputOffset + index] = row.readFloatLE(index * 4);
        }
      }
    }
  } finally {
    await handle.close();
  }

  return values;
}

function encodeFgClipTokenIds(
  model: ResolvedClipModel,
  runtime: FgClipTextRuntime,
  query: string,
): Int32Array {
  const encoded = runtime.tokenizer.encode(query.toLowerCase(), {
    add_special_tokens: true,
  });
  const contextLength = model.manifest.text.context_length;
  const inputIds = new Int32Array(contextLength);
  inputIds.fill(0);
  for (let index = 0; index < Math.min(contextLength, encoded.ids.length); index += 1) {
    inputIds[index] = encoded.ids[index];
  }
  return inputIds;
}

function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let sum = 0;
  for (const value of embedding) {
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm <= 0) {
    return embedding;
  }
  const normalized = new Float32Array(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    normalized[index] = embedding[index] / norm;
  }
  return normalized;
}

function flattenTensorData(tensor: ort.Tensor): Float32Array {
  if (!(tensor.data instanceof Float32Array)) {
    throw new Error(`Unsupported tensor output type: ${tensor.type}`);
  }
  return tensor.data.length === 0 ? new Float32Array() : new Float32Array(tensor.data);
}

function extractEmbeddingFromOutput(
  output: ort.InferenceSession.ReturnType[string],
  expectedDimension: number,
  normalizeOutput: boolean,
): Float32Array {
  if (!(output instanceof ort.Tensor)) {
    throw new Error("模型输出不是 Tensor。");
  }
  const embedding = flattenTensorData(output);
  if (embedding.length !== expectedDimension) {
    throw new Error(`模型输出维度异常：期望 ${expectedDimension}，实际 ${embedding.length}。`);
  }
  return normalizeOutput ? normalizeEmbedding(embedding) : embedding;
}

export function getSessionInputType(
  session: ort.InferenceSession,
  inputName: string,
): string | undefined {
  const inputIndex = session.inputNames.indexOf(inputName);
  if (inputIndex < 0) {
    return undefined;
  }
  const metadata = session.inputMetadata[inputIndex];
  return metadata?.isTensor ? metadata.type : undefined;
}

export function intTensorForType(
  type: string | undefined,
  values: Int32Array,
  dims: readonly number[],
): ort.Tensor {
  if (type === "int64") {
    return new ort.Tensor(
      "int64",
      BigInt64Array.from(values, (value) => BigInt(value)),
      dims,
    );
  }
  return new ort.Tensor("int32", values, dims);
}

export async function encodeChineseClipText(
  model: ResolvedClipModel,
  runtime: ChineseClipTextRuntime,
  textSession: ort.InferenceSession,
  query: string,
): Promise<Float32Array> {
  if (model.manifest.text.input.kind !== "bert_like") {
    throw new Error("chinese_clip 文本输入配置无效。");
  }

  const encoded = runtime.tokenizer.encode(query);
  const textInput = model.manifest.text.input;
  const inputIdsName = textInput.input_ids_name;
  const attentionMaskName = textInput.attention_mask_name;
  if (!inputIdsName || !attentionMaskName) {
    throw new Error("chinese_clip 文本输入名称配置无效。");
  }
  const inputDims = [1, model.manifest.text.context_length] as const;
  const inputIdsType = getSessionInputType(textSession, inputIdsName);
  const attentionMaskType = getSessionInputType(textSession, attentionMaskName);
  const tokenTypeIdsName = textInput.token_type_ids_name;
  const tokenTypeIdsType = tokenTypeIdsName
    ? getSessionInputType(textSession, tokenTypeIdsName)
    : undefined;

  const feeds: Record<string, ort.Tensor> = {
    [inputIdsName]: intTensorForType(inputIdsType, encoded.inputIds, inputDims),
    [attentionMaskName]: intTensorForType(attentionMaskType, encoded.attentionMask, inputDims),
  };
  if (tokenTypeIdsName) {
    feeds[tokenTypeIdsName] = intTensorForType(tokenTypeIdsType, encoded.tokenTypeIds, inputDims);
  }

  const outputs = await textSession.run(feeds as ort.InferenceSession.FeedsType, [
    model.manifest.text.output_name,
  ]);
  return extractEmbeddingFromOutput(
    outputs[model.manifest.text.output_name],
    model.manifest.embedding_dim,
    model.manifest.normalize_output !== false,
  );
}

export async function encodeFgClipText(
  model: ResolvedClipModel,
  runtime: FgClipTextRuntime,
  textSession: ort.InferenceSession,
  query: string,
): Promise<Float32Array> {
  const inputIds = encodeFgClipTokenIds(model, runtime, query);
  const tokenEmbeds = await gatherTokenEmbeddingRows(runtime, inputIds);
  const feeds: ort.InferenceSession.FeedsType = {
    token_embeds: new ort.Tensor("float32", tokenEmbeds, [
      1,
      model.manifest.text.context_length,
      runtime.tokenEmbeddingDim,
    ]),
  };
  const outputs = await textSession.run(feeds, [model.manifest.text.output_name]);
  return extractEmbeddingFromOutput(
    outputs[model.manifest.text.output_name],
    model.manifest.embedding_dim,
    model.manifest.normalize_output !== false,
  );
}

export async function encodeChineseClipImage(
  model: ResolvedClipModel,
  imageSession: ort.InferenceSession,
  filePath: string,
): Promise<Float32Array> {
  const tensor = await preprocessChineseClipImage(filePath, model.manifest);
  const preprocess = model.manifest.image.preprocess;
  if (preprocess.kind !== "clip_image") {
    throw new Error("chinese_clip 图片预处理配置无效。");
  }

  const inputName = imageSession.inputNames[0];
  const feeds: ort.InferenceSession.FeedsType = {
    [inputName]: new ort.Tensor("float32", tensor, [
      1,
      3,
      preprocess.image_size ?? 0,
      preprocess.image_size ?? 0,
    ]),
  };
  const outputs = await imageSession.run(feeds, [model.manifest.image.output_name]);
  return extractEmbeddingFromOutput(
    outputs[model.manifest.image.output_name],
    model.manifest.embedding_dim,
    model.manifest.normalize_output !== false,
  );
}

export async function encodeFgClipImage(
  model: ResolvedClipModel,
  runtime: FgClipImageRuntimeHandle,
  imageSession: ort.InferenceSession,
  filePath: string,
): Promise<Float32Array> {
  const inputs = await preprocessFgClipImage(filePath, runtime);
  const maskType = getSessionInputType(imageSession, "pixel_attention_mask");
  const feeds: ort.InferenceSession.FeedsType = {
    pixel_values: new ort.Tensor("float32", inputs.pixelValues, [
      1,
      inputs.maxPatches,
      inputs.channels,
    ]),
    pixel_attention_mask: intTensorForType(maskType, inputs.pixelAttentionMask, [
      1,
      inputs.maxPatches,
    ]),
    pos_embed: new ort.Tensor("float32", inputs.posEmbed, [
      1,
      inputs.maxPatches,
      model.manifest.embedding_dim,
    ]),
  };
  const outputs = await imageSession.run(feeds, [model.manifest.image.output_name]);
  return extractEmbeddingFromOutput(
    outputs[model.manifest.image.output_name],
    model.manifest.embedding_dim,
    model.manifest.normalize_output !== false,
  );
}
