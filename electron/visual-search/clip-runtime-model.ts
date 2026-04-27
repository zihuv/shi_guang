import { Tokenizer as HuggingFaceTokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { BertWordPieceTokenizer } from "./bert-wordpiece.js";
import type { FgClipImageRuntime } from "./clip-image-preprocess.js";
import type { ClipEffectiveProvider, ClipRuntimeSnapshot, FlatManifest } from "./clip-manifest.js";

export type OrtExecutionProvider = "cpu" | "dml" | "coreml";

export type ResolvedClipModel = {
  manifest: FlatManifest;
  normalizedModelPath: string;
  textModelPath: string;
  imageModelPath: string;
  tokenizerPath: string;
  tokenEmbeddingPath: string | null;
  visionPosEmbeddingPath: string | null;
};

export type ChineseClipTextRuntime = {
  kind: "chinese_clip";
  tokenizer: BertWordPieceTokenizer;
};

export type FgClipTextRuntime = {
  kind: "fg_clip";
  tokenizer: HuggingFaceTokenizer;
  tokenEmbeddingPath: string;
  tokenEmbeddingRows: number;
  tokenEmbeddingDtype: "f16" | "f32";
  tokenEmbeddingDim: number;
};

export type ChineseClipImageRuntime = {
  kind: "chinese_clip";
};

export type FgClipImageRuntimeHandle = FgClipImageRuntime & {
  kind: "fg_clip";
};

export type ClipTextRuntime = ChineseClipTextRuntime | FgClipTextRuntime;
export type ClipImageRuntime = ChineseClipImageRuntime | FgClipImageRuntimeHandle;

export type RuntimeHandle = {
  key: string;
  model: ResolvedClipModel;
  providerAttempt: ProviderAttempt | null;
  textRuntime: ClipTextRuntime | null;
  textRuntimePromise: Promise<ClipTextRuntime> | null;
  imageRuntime: ClipImageRuntime | null;
  imageRuntimePromise: Promise<ClipImageRuntime> | null;
  textSession: ort.InferenceSession | null;
  textSessionPromise: Promise<ort.InferenceSession> | null;
  imageSession: ort.InferenceSession | null;
  imageSessionPromise: Promise<ort.InferenceSession> | null;
};

export type ProviderAttempt = {
  providers: OrtExecutionProvider[];
  effectiveProvider: ClipEffectiveProvider;
  runtimeMode: ClipRuntimeSnapshot["runtimeMode"];
  reason: string;
};
