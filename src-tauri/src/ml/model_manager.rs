use crate::db::Database;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const VISUAL_SEARCH_SETTING_KEY: &str = "visualSearch";
pub const AI_AUTO_ANALYZE_ON_IMPORT_SETTING_KEY: &str = "aiAutoAnalyzeOnImport";

const DEFAULT_SPLIT_TEXT_MODEL_FILE: &str = "split/fgclip2_text_short_b1_s64_token_embeds.onnx";
const DEFAULT_IMAGE_MODEL_FILE: &str = "fgclip2_image_core_posin_dynamic.onnx";
const DEFAULT_TEXT_TOKEN_EMBEDDING_FILE: &str = "assets/text_token_embedding_256000x768_f16.bin";
const DEFAULT_TOKENIZER_JSON_FILE: &str = "tokenizer.json";
const DEFAULT_MANIFEST_FILE: &str = "manifest.json";
const DEFAULT_ASSETS_DIR: &str = "assets";
const DEFAULT_VISION_POS_EMBEDDING_FILE: &str = "assets/vision_pos_embedding_16x16x768_f32.bin";
const DEFAULT_LOGIT_PARAMS_FILE: &str = "assets/logit_params.json";
const DEFAULT_CONTEXT_LENGTH: usize = 64;
const DEFAULT_EMBEDDING_DIM: usize = 768;
const DEBUG_VISUAL_MODEL_RELATIVE_DIRS: [&str; 3] = [
    ".debug-models/fgclip/cpu",
    ".debug-models/fgclip2",
    ".onnx-wrapper-test",
];
const VISUAL_MODEL_DIR_ENV: &str = "SHIGUANG_VISUAL_MODEL_DIR";
const TEXT_ONNX_ENV: &str = "FGCLIP2_TEXT_ONNX";
const IMAGE_ONNX_ENV: &str = "FGCLIP2_IMAGE_ONNX";
const TEXT_TOKEN_EMBEDDING_ENV: &str = "FGCLIP2_TEXT_TOKEN_EMBEDDING";
const TEXT_TOKEN_EMBEDDING_DTYPE_ENV: &str = "FGCLIP2_TEXT_TOKEN_EMBEDDING_DTYPE";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextTokenEmbeddingDtype {
    F16,
    F32,
}

impl TextTokenEmbeddingDtype {
    pub fn bytes_per_value(self) -> usize {
        match self {
            Self::F16 => 2,
            Self::F32 => 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualSearchConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub model_path: String,
    #[serde(default)]
    pub auto_vectorize_on_import: bool,
}

impl Default for VisualSearchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            model_path: String::new(),
            auto_vectorize_on_import: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualModelValidationResult {
    pub valid: bool,
    pub message: String,
    pub normalized_model_path: String,
    pub model_id: Option<String>,
    pub version: Option<String>,
    pub embedding_dim: Option<usize>,
    pub context_length: Option<usize>,
    pub missing_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelManifest {
    pub model_id: String,
    pub version: String,
    #[serde(default)]
    pub model_type: String,
    #[serde(default = "default_embedding_dim")]
    pub embedding_dim: usize,
    #[serde(default = "default_context_length")]
    pub context_length: usize,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub sha256: Option<ManifestSha256>,
    #[serde(default, alias = "imageModelFile", alias = "image_model_file")]
    pub image_model_file: Option<String>,
    #[serde(default, alias = "textModelFile", alias = "text_model_file")]
    pub text_model_file: Option<String>,
    #[serde(
        default,
        alias = "textTokenEmbeddingFile",
        alias = "text_token_embedding_file"
    )]
    pub text_token_embedding_file: Option<String>,
    #[serde(
        default,
        alias = "textTokenEmbeddingDtype",
        alias = "text_token_embedding_dtype"
    )]
    pub text_token_embedding_dtype: Option<String>,
    #[serde(
        default,
        alias = "tokenizerFile",
        alias = "tokenizer_file",
        alias = "tokenizerJsonFile",
        alias = "tokenizer_json_file"
    )]
    pub tokenizer_json_file: Option<String>,
    #[serde(
        default,
        alias = "visionPosEmbeddingFile",
        alias = "vision_pos_embedding_file"
    )]
    pub vision_pos_embedding_file: Option<String>,
    #[serde(default, alias = "logitParamsFile", alias = "logit_params_file")]
    pub logit_params_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ManifestSha256 {
    Bundle(String),
    Files(HashMap<String, String>),
}

#[derive(Debug, Clone)]
pub struct ResolvedModelPaths {
    pub root: PathBuf,
    pub manifest_path: Option<PathBuf>,
    pub text_model_path: PathBuf,
    pub text_token_embedding_path: PathBuf,
    pub text_token_embedding_dtype: TextTokenEmbeddingDtype,
    pub image_model_path: PathBuf,
    pub tokenizer_json_path: PathBuf,
    pub vision_pos_embedding_path: PathBuf,
    pub logit_params_path: Option<PathBuf>,
    pub manifest: ModelManifest,
}

fn default_context_length() -> usize {
    DEFAULT_CONTEXT_LENGTH
}

fn default_embedding_dim() -> usize {
    DEFAULT_EMBEDDING_DIM
}

pub fn load_visual_search_config(db: &Database) -> Result<VisualSearchConfig, String> {
    let raw_value = match db
        .get_setting(VISUAL_SEARCH_SETTING_KEY)
        .map_err(|e| e.to_string())?
    {
        Some(value) => value,
        None => return Ok(VisualSearchConfig::default()),
    };

    serde_json::from_str(&raw_value).map_err(|e| format!("解析本地视觉搜索配置失败: {}", e))
}

pub fn load_auto_analyze_on_import(db: &Database) -> Result<bool, String> {
    let raw_value = db
        .get_setting(AI_AUTO_ANALYZE_ON_IMPORT_SETTING_KEY)
        .map_err(|e| e.to_string())?;

    Ok(matches!(
        raw_value.as_deref(),
        Some("true") | Some("1") | Some("yes")
    ))
}

pub fn find_recommended_visual_model_path() -> Option<String> {
    if let Ok(path) = std::env::var(VISUAL_MODEL_DIR_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() && resolve_model_paths(trimmed).is_ok() {
            return Some(canonical_string(Path::new(trimmed)));
        }
    }

    let mut roots = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        roots.extend(current_dir.ancestors().map(Path::to_path_buf));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            roots.extend(parent.ancestors().map(Path::to_path_buf));
        }
    }

    let mut seen = HashSet::new();
    for root in roots {
        if !seen.insert(root.clone()) {
            continue;
        }

        for relative_dir in DEBUG_VISUAL_MODEL_RELATIVE_DIRS {
            let candidate = root.join(relative_dir);
            if !candidate.is_dir() {
                continue;
            }

            let candidate_string = candidate.to_string_lossy().to_string();
            if resolve_model_paths(&candidate_string).is_ok() {
                return Some(canonical_string(&candidate));
            }
        }
    }

    None
}

pub fn validate_visual_model_path(model_path: &str) -> VisualModelValidationResult {
    let normalized_model_path = model_path.trim().to_string();
    if normalized_model_path.is_empty() {
        return VisualModelValidationResult {
            valid: false,
            message: "请先选择 fgclip2 ONNX 模型目录".to_string(),
            normalized_model_path,
            model_id: None,
            version: None,
            embedding_dim: None,
            context_length: None,
            missing_files: Vec::new(),
        };
    }

    match resolve_model_paths(model_path) {
        Ok(resolved) => VisualModelValidationResult {
            valid: true,
            message: "fgclip2 模型目录可用".to_string(),
            normalized_model_path: resolved.root.to_string_lossy().to_string(),
            model_id: Some(resolved.manifest.model_id.clone()),
            version: Some(resolved.manifest.version.clone()),
            embedding_dim: Some(resolved.manifest.embedding_dim),
            context_length: Some(resolved.manifest.context_length),
            missing_files: Vec::new(),
        },
        Err(error) => {
            let missing_files = collect_missing_files(Path::new(&normalized_model_path));
            VisualModelValidationResult {
                valid: false,
                message: error,
                normalized_model_path,
                model_id: None,
                version: None,
                embedding_dim: None,
                context_length: None,
                missing_files,
            }
        }
    }
}

pub fn resolve_model_paths(model_path: &str) -> Result<ResolvedModelPaths, String> {
    let trimmed = model_path.trim();
    if trimmed.is_empty() {
        return Err("请先选择 fgclip2 ONNX 模型目录".to_string());
    }

    let root = PathBuf::from(trimmed);
    if !root.exists() {
        return Err("模型目录不存在".to_string());
    }
    if !root.is_dir() {
        return Err("模型路径必须是目录".to_string());
    }

    for candidate_root in candidate_roots(&root) {
        if let Some(resolved) = try_resolve_manifest_layout(&candidate_root)? {
            return Ok(resolved);
        }
        if let Some(resolved) = try_resolve_fgclip2_layout(&candidate_root)? {
            return Ok(resolved);
        }
    }

    Err("模型目录缺少 fgclip2 split-text 运行文件；请选择包含 split/fgclip2_text_short_b1_s64_token_embeds.onnx、assets/text_token_embedding_256000x768_f16.bin、fgclip2_image_core_posin_dynamic.onnx、assets/vision_pos_embedding_16x16x768_f32.bin 和 tokenizer.json 的目录".to_string())
}

fn candidate_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_path_buf()];

    let wrapper_child = root.join(".onnx-wrapper-test");
    if wrapper_child.is_dir() {
        roots.push(wrapper_child);
    }

    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if matches!(name, "assets" | "fixtures") {
        if let Some(parent) = root.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
}

fn try_resolve_manifest_layout(root: &Path) -> Result<Option<ResolvedModelPaths>, String> {
    let manifest_path = root.join(DEFAULT_MANIFEST_FILE);
    if !manifest_path.exists() {
        return Ok(None);
    }

    let manifest_content =
        fs::read_to_string(&manifest_path).map_err(|e| format!("无法读取 manifest.json: {}", e))?;
    let manifest_value: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("manifest.json 格式无效: {}", e))?;

    if manifest_value.get("model_id").is_none()
        && manifest_value.get("version").is_none()
        && manifest_value.get("onnx").is_some()
        && manifest_value.get("tensors").is_some()
    {
        return Ok(None);
    }

    let manifest: ModelManifest = serde_json::from_value(manifest_value)
        .map_err(|e| format!("manifest.json 格式无效: {}", e))?;
    validate_manifest(&manifest)?;

    let text_model_path =
        require_split_text_model_file(&resolve_text_model_path(root, Some(&manifest)))?;
    let text_token_embedding_path = require_file(
        &resolve_text_token_embedding_path(root, Some(&manifest)),
        "文本 token embedding",
    )?;
    let text_token_embedding_dtype =
        resolve_text_token_embedding_dtype(Some(&manifest), &text_token_embedding_path)?;
    let image_model_path = require_file(
        &resolve_image_model_path(root, Some(&manifest)),
        "图像 ONNX 模型",
    )?;
    let tokenizer_json_path =
        if let Some(tokenizer_json_file) = manifest.tokenizer_json_file.as_ref() {
            require_file(
                &resolve_relative_or_absolute(root, tokenizer_json_file),
                "tokenizer.json",
            )?
        } else {
            resolve_tokenizer_json_path(root)?
        };
    let vision_pos_embedding_path = require_file(
        &resolve_relative_or_absolute(
            root,
            manifest
                .vision_pos_embedding_file
                .as_deref()
                .unwrap_or(DEFAULT_VISION_POS_EMBEDDING_FILE),
        ),
        "vision position embedding",
    )?;
    let logit_params_path = resolve_optional_file(
        root,
        manifest
            .logit_params_file
            .as_deref()
            .unwrap_or(DEFAULT_LOGIT_PARAMS_FILE),
    );

    let resolved = ResolvedModelPaths {
        root: canonical_path(root),
        manifest_path: Some(manifest_path),
        text_model_path,
        text_token_embedding_path,
        text_token_embedding_dtype,
        image_model_path,
        tokenizer_json_path,
        vision_pos_embedding_path,
        logit_params_path,
        manifest,
    };
    verify_model_hashes(&resolved)?;

    Ok(Some(resolved))
}

fn try_resolve_fgclip2_layout(root: &Path) -> Result<Option<ResolvedModelPaths>, String> {
    let text_model_path = resolve_text_model_path(root, None);
    let text_token_embedding_path = resolve_text_token_embedding_path(root, None);
    let image_model_path = resolve_image_model_path(root, None);
    let vision_pos_embedding_path =
        resolve_relative_or_absolute(root, DEFAULT_VISION_POS_EMBEDDING_FILE);

    let has_any_fgclip2_file = text_model_path.exists()
        || text_token_embedding_path.exists()
        || image_model_path.exists()
        || vision_pos_embedding_path.exists();
    if !has_any_fgclip2_file {
        return Ok(None);
    }

    let text_model_path = require_split_text_model_file(&text_model_path)?;
    let text_token_embedding_path =
        require_file(&text_token_embedding_path, "文本 token embedding")?;
    let text_token_embedding_dtype =
        resolve_text_token_embedding_dtype(None, &text_token_embedding_path)?;
    let image_model_path = require_file(&image_model_path, "图像 ONNX 模型")?;
    let tokenizer_json_path = resolve_tokenizer_json_path(root)?;
    let vision_pos_embedding_path =
        require_file(&vision_pos_embedding_path, "vision position embedding")?;
    let logit_params_path = resolve_optional_file(root, DEFAULT_LOGIT_PARAMS_FILE);
    let fingerprint = model_metadata_fingerprint(&[
        text_model_path.as_path(),
        text_token_embedding_path.as_path(),
        image_model_path.as_path(),
    ]);
    let manifest = ModelManifest {
        model_id: format!("fgclip2-base@{fingerprint}"),
        version: format!("onnx-wrapper:{fingerprint}"),
        model_type: "fgclip2".to_string(),
        embedding_dim: DEFAULT_EMBEDDING_DIM,
        context_length: DEFAULT_CONTEXT_LENGTH,
        source_url: String::new(),
        sha256: None,
        image_model_file: Some(path_for_manifest(root, &image_model_path)),
        text_model_file: Some(path_for_manifest(root, &text_model_path)),
        text_token_embedding_file: Some(path_for_manifest(root, &text_token_embedding_path)),
        text_token_embedding_dtype: Some(
            text_token_embedding_dtype_name(text_token_embedding_dtype).to_string(),
        ),
        tokenizer_json_file: Some(path_for_manifest(root, &tokenizer_json_path)),
        vision_pos_embedding_file: Some(path_for_manifest(root, &vision_pos_embedding_path)),
        logit_params_file: logit_params_path
            .as_ref()
            .map(|path| path_for_manifest(root, path)),
    };

    Ok(Some(ResolvedModelPaths {
        root: canonical_path(root),
        manifest_path: None,
        text_model_path,
        text_token_embedding_path,
        text_token_embedding_dtype,
        image_model_path,
        tokenizer_json_path,
        vision_pos_embedding_path,
        logit_params_path,
        manifest,
    }))
}

fn resolve_text_model_path(root: &Path, manifest: Option<&ModelManifest>) -> PathBuf {
    if let Some(path) = resolve_env_override_path(root, TEXT_ONNX_ENV) {
        return path;
    }

    if let Some(path) = manifest
        .and_then(|item| item.text_model_file.as_deref())
        .map(|value| resolve_relative_or_absolute(root, value))
    {
        return path;
    }

    resolve_relative_or_absolute(root, DEFAULT_SPLIT_TEXT_MODEL_FILE)
}

fn resolve_text_token_embedding_path(root: &Path, manifest: Option<&ModelManifest>) -> PathBuf {
    if let Some(path) = resolve_env_override_path(root, TEXT_TOKEN_EMBEDDING_ENV) {
        return path;
    }

    if let Some(path) = manifest
        .and_then(|item| item.text_token_embedding_file.as_deref())
        .map(|value| resolve_relative_or_absolute(root, value))
    {
        return path;
    }

    resolve_relative_or_absolute(root, DEFAULT_TEXT_TOKEN_EMBEDDING_FILE)
}

fn resolve_image_model_path(root: &Path, manifest: Option<&ModelManifest>) -> PathBuf {
    if let Some(path) = resolve_env_override_path(root, IMAGE_ONNX_ENV) {
        return path;
    }

    if let Some(path) = manifest
        .and_then(|item| item.image_model_file.as_deref())
        .map(|value| resolve_relative_or_absolute(root, value))
    {
        return path;
    }

    resolve_relative_or_absolute(root, DEFAULT_IMAGE_MODEL_FILE)
}

fn require_split_text_model_file(path: &Path) -> Result<PathBuf, String> {
    let path = require_file(path, "split-text 文本 ONNX 模型")?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if file_name.contains("token_embeds") {
        Ok(path)
    } else {
        Err("当前仅支持 split-text 文本模型，请选择 split/fgclip2_text_short_b1_s64_token_embeds.onnx".to_string())
    }
}

fn validate_manifest(manifest: &ModelManifest) -> Result<(), String> {
    if manifest.model_id.trim().is_empty() {
        return Err("manifest.json 缺少 model_id".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("manifest.json 缺少 version".to_string());
    }
    if !manifest.model_type.trim().is_empty() && manifest.model_type.trim() != "fgclip2" {
        return Err("manifest.json 不是 fgclip2 模型".to_string());
    }
    if manifest.embedding_dim == 0 {
        return Err("manifest.json 的 embedding_dim 无效".to_string());
    }
    if manifest.context_length == 0 {
        return Err("manifest.json 的 context_length 无效".to_string());
    }

    Ok(())
}

fn resolve_tokenizer_json_path(root: &Path) -> Result<PathBuf, String> {
    let mut candidates = vec![
        root.join(DEFAULT_TOKENIZER_JSON_FILE),
        root.join(DEFAULT_ASSETS_DIR)
            .join(DEFAULT_TOKENIZER_JSON_FILE),
    ];

    if let Some(parent) = root.parent() {
        candidates.push(
            parent
                .join("models")
                .join("fg-clip2-base")
                .join(DEFAULT_TOKENIZER_JSON_FILE),
        );
        candidates.push(
            parent
                .join("fg-clip2-base")
                .join(DEFAULT_TOKENIZER_JSON_FILE),
        );
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(
        "模型目录缺少 tokenizer.json；可放在模型目录，或放在相邻的 models/fg-clip2-base/ 下"
            .to_string(),
    )
}

fn resolve_relative_or_absolute(root: &Path, path_value: &str) -> PathBuf {
    let path = PathBuf::from(path_value);
    if path.is_absolute() {
        return path;
    }

    let candidate = root.join(&path);
    if candidate.exists() {
        return candidate;
    }

    let root_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if root_name == ".onnx-wrapper-test" {
        if let Some(parent) = root.parent() {
            let parent_candidate = parent.join(&path);
            if parent_candidate.exists() {
                return parent_candidate;
            }
        }
    }

    candidate
}

fn resolve_env_override_path(root: &Path, env_key: &str) -> Option<PathBuf> {
    let value = std::env::var(env_key).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(resolve_relative_or_absolute(root, trimmed))
}

fn resolve_text_token_embedding_dtype(
    manifest: Option<&ModelManifest>,
    embedding_path: &Path,
) -> Result<TextTokenEmbeddingDtype, String> {
    if let Some(value) = manifest.and_then(|item| item.text_token_embedding_dtype.as_deref()) {
        return parse_text_token_embedding_dtype(value);
    }

    if let Ok(value) = std::env::var(TEXT_TOKEN_EMBEDDING_DTYPE_ENV) {
        return parse_text_token_embedding_dtype(&value);
    }

    if embedding_path.to_string_lossy().contains("_f32") {
        Ok(TextTokenEmbeddingDtype::F32)
    } else {
        Ok(TextTokenEmbeddingDtype::F16)
    }
}

fn parse_text_token_embedding_dtype(value: &str) -> Result<TextTokenEmbeddingDtype, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "f16" | "float16" => Ok(TextTokenEmbeddingDtype::F16),
        "f32" | "float32" => Ok(TextTokenEmbeddingDtype::F32),
        other => Err(format!(
            "不支持的文本 token embedding dtype: {other}，仅支持 f16 或 f32"
        )),
    }
}

fn text_token_embedding_dtype_name(dtype: TextTokenEmbeddingDtype) -> &'static str {
    match dtype {
        TextTokenEmbeddingDtype::F16 => "f16",
        TextTokenEmbeddingDtype::F32 => "f32",
    }
}

fn resolve_optional_file(root: &Path, path_value: &str) -> Option<PathBuf> {
    let path = resolve_relative_or_absolute(root, path_value);
    path.is_file().then_some(path)
}

fn require_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    if path.is_file() {
        Ok(path.to_path_buf())
    } else {
        Err(format!("模型目录缺少 {label}"))
    }
}

fn collect_missing_files(root: &Path) -> Vec<String> {
    let root = if root.join(".onnx-wrapper-test").is_dir() {
        root.join(".onnx-wrapper-test")
    } else {
        root.to_path_buf()
    };

    let mut missing_files = Vec::new();
    for path in [
        root.join(DEFAULT_SPLIT_TEXT_MODEL_FILE),
        root.join(DEFAULT_TEXT_TOKEN_EMBEDDING_FILE),
        root.join(DEFAULT_IMAGE_MODEL_FILE),
        root.join(DEFAULT_VISION_POS_EMBEDDING_FILE),
    ] {
        if !path.is_file() {
            missing_files.push(path_for_manifest(&root, &path));
        }
    }

    if resolve_tokenizer_json_path(&root).is_err() {
        missing_files.push(DEFAULT_TOKENIZER_JSON_FILE.to_string());
    }

    missing_files
}

fn verify_model_hashes(resolved: &ResolvedModelPaths) -> Result<(), String> {
    let Some(ManifestSha256::Files(file_hashes)) = resolved.manifest.sha256.as_ref() else {
        return Ok(());
    };

    for (relative_name, expected_hash) in file_hashes {
        let file_path = resolved.root.join(relative_name);
        if !file_path.exists() {
            return Err(format!(
                "manifest.json 中声明的校验文件不存在: {relative_name}"
            ));
        }

        let actual_hash = sha256_file(&file_path)?;
        if actual_hash.to_lowercase() != expected_hash.trim().to_lowercase() {
            return Err(format!("文件校验失败: {relative_name}"));
        }
    }

    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("无法读取 '{}' 进行校验: {}", path.display(), e))?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

fn model_metadata_fingerprint(paths: &[&Path]) -> String {
    let mut hasher = Sha256::new();
    for path in paths {
        hasher.update(
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(""),
        );
        if let Ok(metadata) = fs::metadata(path) {
            hasher.update(metadata.len().to_le_bytes());
            let modified_secs = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or_default();
            hasher.update(modified_secs.to_le_bytes());
        }
    }

    format!("{:x}", hasher.finalize())
        .chars()
        .take(12)
        .collect()
}

fn path_for_manifest(root: &Path, path: &Path) -> String {
    if let Ok(relative) = path.strip_prefix(root) {
        path_to_manifest_string(relative)
    } else {
        path.to_string_lossy().replace('\\', "/")
    }
}

fn path_to_manifest_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn canonical_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn canonical_string(path: &Path) -> String {
    canonical_path(path).to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "shiguang-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_minimal_split_fgclip2_wrapper(root: &Path) {
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::create_dir_all(root.join("split")).unwrap();
        std::fs::write(root.join(DEFAULT_SPLIT_TEXT_MODEL_FILE), b"text").unwrap();
        std::fs::write(root.join(DEFAULT_IMAGE_MODEL_FILE), b"image").unwrap();
        std::fs::write(root.join(DEFAULT_VISION_POS_EMBEDDING_FILE), b"pos").unwrap();
        std::fs::write(root.join(DEFAULT_TEXT_TOKEN_EMBEDDING_FILE), b"embed").unwrap();
    }

    fn write_minimal_full_text_fgclip2_wrapper(root: &Path) {
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("fgclip2_text_short_b1_s64.onnx"), b"text").unwrap();
        std::fs::write(root.join(DEFAULT_IMAGE_MODEL_FILE), b"image").unwrap();
        std::fs::write(root.join(DEFAULT_VISION_POS_EMBEDDING_FILE), b"pos").unwrap();
    }

    #[test]
    fn resolves_wrapper_layout_with_sibling_huggingface_tokenizer() {
        let parent = unique_temp_dir("fgclip2-parent");
        let wrapper = parent.join(".onnx-wrapper-test");
        let hf_model = parent.join("models").join("fg-clip2-base");
        std::fs::create_dir_all(&hf_model).unwrap();
        write_minimal_split_fgclip2_wrapper(&wrapper);
        std::fs::write(hf_model.join("tokenizer.json"), b"{}").unwrap();

        let resolved = resolve_model_paths(wrapper.to_string_lossy().as_ref()).unwrap();
        assert_eq!(resolved.manifest.embedding_dim, 768);
        assert_eq!(resolved.manifest.context_length, 64);
        assert!(resolved
            .text_model_path
            .ends_with(Path::new(DEFAULT_SPLIT_TEXT_MODEL_FILE)));
        assert!(resolved
            .text_token_embedding_path
            .ends_with(Path::new(DEFAULT_TEXT_TOKEN_EMBEDDING_FILE)));
        assert!(resolved
            .tokenizer_json_path
            .ends_with("fg-clip2-base/tokenizer.json"));

        let _ = std::fs::remove_dir_all(parent);
    }

    #[test]
    fn resolves_parent_directory_that_contains_wrapper_child() {
        let parent = unique_temp_dir("fgclip2-parent-child");
        let wrapper = parent.join(".onnx-wrapper-test");
        std::fs::create_dir_all(&parent).unwrap();
        write_minimal_split_fgclip2_wrapper(&wrapper);
        std::fs::write(wrapper.join(DEFAULT_TOKENIZER_JSON_FILE), b"{}").unwrap();

        let resolved = resolve_model_paths(parent.to_string_lossy().as_ref()).unwrap();
        assert_eq!(resolved.root, canonical_path(&wrapper));
        assert!(resolved
            .text_model_path
            .ends_with(Path::new(DEFAULT_SPLIT_TEXT_MODEL_FILE)));

        let _ = std::fs::remove_dir_all(parent);
    }

    #[test]
    fn rejects_full_text_wrapper_when_split_text_is_required() {
        let root = unique_temp_dir("fgclip2-full-text");
        std::fs::create_dir_all(&root).unwrap();
        write_minimal_full_text_fgclip2_wrapper(&root);
        std::fs::write(root.join(DEFAULT_TOKENIZER_JSON_FILE), b"{}").unwrap();

        let error = resolve_model_paths(root.to_string_lossy().as_ref()).unwrap_err();
        assert!(error.contains("split-text"));

        let _ = std::fs::remove_dir_all(root);
    }
}
