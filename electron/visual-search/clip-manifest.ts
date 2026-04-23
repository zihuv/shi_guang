import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

export type ClipRuntimeDevice = "auto" | "cpu" | "gpu";
export type ClipProviderPolicy = "auto" | "interactive" | "service";
export type ClipRuntimeThreadConfig = "auto" | number;
export type ClipEffectiveProvider = "tensorrt" | "cuda" | "direct_ml" | "core_ml" | "cpu";

export interface ClipRuntimeConfig {
  device: ClipRuntimeDevice;
  providerPolicy: ClipProviderPolicy;
  intraThreads: ClipRuntimeThreadConfig;
  fgclipMaxPatches: number | null;
}

export interface ClipModelValidationResult {
  valid: boolean;
  message: string;
  normalizedModelPath: string;
  modelId: string | null;
  version: string | null;
  embeddingDim: number | null;
  contextLength: number | null;
  missingFiles: string[];
}

export interface ClipRuntimeSnapshot {
  runtimeLoaded: boolean;
  runtimeMode: "uninitialized" | "cpu_only" | "gpu_enabled" | "mixed" | "unknown" | null;
  effectiveProvider: ClipEffectiveProvider | null;
  runtimeReason: string | null;
}

export type FlatManifest = {
  format: string;
  schema_version: number;
  family: "chinese_clip" | "fg_clip" | "open_clip" | string;
  model_id: string;
  model_revision?: string;
  embedding_dim: number;
  normalize_output?: boolean;
  text: {
    onnx: string;
    output_name: string;
    tokenizer: string;
    context_length: number;
    input:
      | {
          kind: "bert_like";
          input_ids_name: string;
          attention_mask_name: string;
          token_type_ids_name?: string;
        }
      | {
          kind: "token_embeds";
        }
      | {
          kind: string;
          input_ids_name?: string;
          attention_mask_name?: string;
          token_type_ids_name?: string;
        };
    token_embedding?: {
      file: string;
      dtype: "f16" | "f32" | string;
      embedding_dim: number;
    };
  };
  image: {
    onnx: string;
    output_name: string;
    preprocess:
      | {
          kind: "clip_image";
          image_size: number;
          resize_shortest_edge?: number;
          crop?: "none" | "center";
          mean: number[];
          std: number[];
        }
      | {
          kind: "fgclip_patch_tokens";
          patch_size: number;
          default_max_patches: number;
          vision_pos_embedding: string;
        }
      | {
          kind: string;
          image_size?: number;
          resize_shortest_edge?: number;
          crop?: "none" | "center";
          mean?: number[];
          std?: number[];
          patch_size?: number;
          default_max_patches?: number;
          vision_pos_embedding?: string;
        };
  };
};

export async function readFlatManifest(modelPath: string): Promise<FlatManifest> {
  return JSON.parse(
    await fs.readFile(path.join(modelPath, "model_config.json"), "utf8"),
  ) as FlatManifest;
}

export function missingFilesForManifest(modelPath: string, manifest: FlatManifest): string[] {
  const required = [
    "model_config.json",
    manifest.text.onnx,
    manifest.image.onnx,
    manifest.text.tokenizer,
  ];

  if (manifest.family === "fg_clip") {
    if (manifest.text.token_embedding?.file) {
      required.push(manifest.text.token_embedding.file);
    } else {
      required.push("text.token_embedding.file");
    }
    if (
      manifest.image.preprocess.kind === "fgclip_patch_tokens" &&
      manifest.image.preprocess.vision_pos_embedding
    ) {
      required.push(manifest.image.preprocess.vision_pos_embedding);
    } else {
      required.push("image.preprocess.vision_pos_embedding");
    }
  }

  return required.filter((relativePath) => {
    if (relativePath.includes(".")) {
      return !fssync.existsSync(path.join(modelPath, relativePath));
    }
    return !fssync.existsSync(path.join(modelPath, relativePath));
  });
}

export function buildClipValidationResult(
  valid: boolean,
  message: string,
  normalizedModelPath: string,
  manifest: FlatManifest | null,
  missingFiles: string[],
): ClipModelValidationResult {
  return {
    valid,
    message,
    normalizedModelPath,
    modelId: manifest?.model_id ?? null,
    version: manifest?.model_revision ?? null,
    embeddingDim: manifest?.embedding_dim ?? null,
    contextLength: manifest?.text.context_length ?? null,
    missingFiles,
  };
}

export function validateFlatClipManifest(
  manifest: FlatManifest,
  normalizedModelPath: string,
): ClipModelValidationResult {
  if (manifest.format !== "omni_flat_v1" || manifest.schema_version !== 1) {
    return buildClipValidationResult(
      false,
      "仅支持 omni_flat_v1 / schema_version=1 的平铺模型目录。",
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (
    !Number.isFinite(manifest.embedding_dim) ||
    manifest.embedding_dim <= 0 ||
    !Number.isFinite(manifest.text.context_length) ||
    manifest.text.context_length <= 2
  ) {
    return buildClipValidationResult(
      false,
      "模型配置缺少有效的 embedding_dim 或 context_length。",
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (manifest.family === "chinese_clip") {
    if (manifest.text.input.kind !== "bert_like") {
      return buildClipValidationResult(
        false,
        `chinese_clip 需要 bert_like 文本输入，收到 ${manifest.text.input.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (manifest.image.preprocess.kind !== "clip_image") {
      return buildClipValidationResult(
        false,
        `chinese_clip 需要 clip_image 图片预处理，收到 ${manifest.image.preprocess.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    return buildClipValidationResult(
      true,
      `模型目录可用：${manifest.model_id} (${manifest.model_revision ?? "unknown"})`,
      normalizedModelPath,
      manifest,
      [],
    );
  }

  if (manifest.family === "fg_clip") {
    if (manifest.text.input.kind !== "token_embeds") {
      return buildClipValidationResult(
        false,
        `fg_clip 需要 token_embeds 文本输入，收到 ${manifest.text.input.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (manifest.image.preprocess.kind !== "fgclip_patch_tokens") {
      return buildClipValidationResult(
        false,
        `fg_clip 需要 fgclip_patch_tokens 图片预处理，收到 ${manifest.image.preprocess.kind}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (!manifest.text.token_embedding) {
      return buildClipValidationResult(
        false,
        "fg_clip 模型配置缺少 text.token_embedding。",
        normalizedModelPath,
        manifest,
        ["text.token_embedding.file"],
      );
    }
    if (manifest.text.token_embedding.embedding_dim !== manifest.embedding_dim) {
      return buildClipValidationResult(
        false,
        "fg_clip token embedding 维度和模型 embedding_dim 不一致。",
        normalizedModelPath,
        manifest,
        [],
      );
    }
    if (
      manifest.text.token_embedding.dtype !== "f16" &&
      manifest.text.token_embedding.dtype !== "f32"
    ) {
      return buildClipValidationResult(
        false,
        `fg_clip token embedding dtype 暂不支持 ${manifest.text.token_embedding.dtype}。`,
        normalizedModelPath,
        manifest,
        [],
      );
    }
    const patchSize = manifest.image.preprocess.patch_size;
    const defaultMaxPatches = manifest.image.preprocess.default_max_patches;
    if ((patchSize ?? 0) <= 0 || (defaultMaxPatches ?? 0) <= 0) {
      return buildClipValidationResult(
        false,
        "fg_clip patch_size 和 default_max_patches 必须大于 0。",
        normalizedModelPath,
        manifest,
        [],
      );
    }
    return buildClipValidationResult(
      true,
      `模型目录可用：${manifest.model_id} (${manifest.model_revision ?? "unknown"})`,
      normalizedModelPath,
      manifest,
      [],
    );
  }

  return buildClipValidationResult(
    false,
    `当前 Electron 版本仅支持 chinese_clip 和 fg_clip，暂不支持 ${manifest.family}。`,
    normalizedModelPath,
    manifest,
    [],
  );
}
