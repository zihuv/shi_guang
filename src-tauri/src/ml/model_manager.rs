use super::image_preprocess::DEFAULT_IMAGE_SIZE;
use crate::db::Database;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const VISUAL_SEARCH_SETTING_KEY: &str = "visualSearch";
pub const AI_AUTO_ANALYZE_ON_IMPORT_SETTING_KEY: &str = "aiAutoAnalyzeOnImport";

const DEFAULT_IMAGE_MODEL_FILE: &str = "model.img.fp32.onnx";
const DEFAULT_TEXT_MODEL_FILE: &str = "model.txt.fp32.onnx";
const DEFAULT_COMBINED_MODEL_FILE: &str = "model.onnx";
const DEFAULT_VOCAB_FILE: &str = "vocab.txt";
const DEFAULT_TOKENIZER_CONFIG_FILE: &str = "tokenizer_config.json";
const DEFAULT_PREPROCESSOR_CONFIG_FILE: &str = "preprocessor_config.json";
const DEFAULT_MANIFEST_FILE: &str = "manifest.json";
const DEFAULT_HUGGINGFACE_CONFIG_FILE: &str = "config.json";
const DEFAULT_HUGGINGFACE_ONNX_DIR: &str = "onnx";
const DEFAULT_HUGGINGFACE_CONTEXT_LENGTH: usize = 52;
const DEBUG_VISUAL_MODEL_RELATIVE_DIR: &str = ".debug-models/chinese-clip-vit-base-patch16";
const HUGGINGFACE_MODEL_FILE_PREFERENCES: [&str; 7] = [
    "model_quantized.onnx",
    "model_uint8.onnx",
    "model_fp16.onnx",
    "model.onnx",
    "model_q4f16.onnx",
    "model_q4.onnx",
    "model_bnb4.onnx",
];

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
    pub embedding_dim: usize,
    pub context_length: usize,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub sha256: Option<ManifestSha256>,
    #[serde(default, alias = "imageModelFile", alias = "image_model_file")]
    pub image_model_file: Option<String>,
    #[serde(default, alias = "textModelFile", alias = "text_model_file")]
    pub text_model_file: Option<String>,
    #[serde(default, alias = "modelFile", alias = "model_file")]
    pub model_file: Option<String>,
    #[serde(default, alias = "vocabFile", alias = "vocab_file")]
    pub vocab_file: Option<String>,
    #[serde(
        default,
        alias = "tokenizerConfigFile",
        alias = "tokenizer_config_file"
    )]
    pub tokenizer_config_file: Option<String>,
    #[serde(
        default,
        alias = "preprocessorConfigFile",
        alias = "preprocessor_config_file"
    )]
    pub preprocessor_config_file: Option<String>,
    #[serde(default, alias = "imageSize", alias = "image_size")]
    pub image_size: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ManifestSha256 {
    Bundle(String),
    Files(HashMap<String, String>),
}

#[derive(Debug, Clone)]
pub enum ResolvedModelFiles {
    Split {
        image_model_path: PathBuf,
        text_model_path: PathBuf,
    },
    Combined {
        model_path: PathBuf,
    },
}

#[derive(Debug, Clone)]
pub struct ResolvedModelPaths {
    pub root: PathBuf,
    pub manifest_path: Option<PathBuf>,
    pub model_files: ResolvedModelFiles,
    pub vocab_path: PathBuf,
    pub tokenizer_config_path: PathBuf,
    pub preprocessor_config_path: Option<PathBuf>,
    pub manifest: ModelManifest,
    pub image_size: usize,
    pub do_lower_case: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct HuggingFaceConfig {
    #[serde(rename = "_name_or_path", default)]
    name_or_path: String,
    #[serde(default)]
    model_type: String,
    #[serde(default)]
    projection_dim: Option<usize>,
    #[serde(default)]
    transformers_version: String,
}

#[derive(Debug, Clone, Deserialize)]
struct HuggingFaceTokenizerConfig {
    #[serde(default = "default_do_lower_case")]
    do_lower_case: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct HuggingFacePreprocessorConfig {
    #[serde(default)]
    size: Option<ImageSizeValue>,
    #[serde(default)]
    crop_size: Option<ImageSizeValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum ImageSizeValue {
    Scalar(usize),
    Map {
        height: Option<usize>,
        width: Option<usize>,
        shortest_edge: Option<usize>,
    },
}

impl ImageSizeValue {
    fn resolve(&self) -> Option<usize> {
        match self {
            Self::Scalar(value) => (*value > 0).then_some(*value),
            Self::Map {
                height,
                width,
                shortest_edge,
            } => (*height)
                .filter(|value| *value > 0)
                .or_else(|| (*width).filter(|value| *value > 0))
                .or_else(|| (*shortest_edge).filter(|value| *value > 0)),
        }
    }
}

fn default_do_lower_case() -> bool {
    true
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

        let candidate = root.join(DEBUG_VISUAL_MODEL_RELATIVE_DIR);
        if !candidate.is_dir() {
            continue;
        }

        let candidate_string = candidate.to_string_lossy().to_string();
        if resolve_model_paths(&candidate_string).is_ok() {
            return Some(
                fs::canonicalize(&candidate)
                    .unwrap_or(candidate)
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    None
}

pub fn validate_visual_model_path(model_path: &str) -> VisualModelValidationResult {
    let normalized_model_path = model_path.trim().to_string();
    if normalized_model_path.is_empty() {
        return VisualModelValidationResult {
            valid: false,
            message: "请先选择 Chinese-CLIP 模型目录".to_string(),
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
            message: "模型目录可用".to_string(),
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
        return Err("请先选择 Chinese-CLIP 模型目录".to_string());
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
        if let Some(resolved) = try_resolve_huggingface_layout(&candidate_root)? {
            return Ok(resolved);
        }
    }

    Err("模型目录缺少 manifest.json，也不是可识别的 Hugging Face Chinese-CLIP 目录".to_string())
}

fn candidate_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_path_buf()];

    if root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(DEFAULT_HUGGINGFACE_ONNX_DIR))
    {
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
    let manifest: ModelManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("manifest.json 格式无效: {}", e))?;

    validate_manifest(&manifest)?;

    let model_files = if let Some(model_file) = manifest.model_file.as_deref() {
        let model_path = root.join(model_file);
        if !model_path.exists() {
            return Err("模型目录缺少 ONNX 模型".to_string());
        }
        ResolvedModelFiles::Combined { model_path }
    } else {
        let image_model_path = root.join(
            manifest
                .image_model_file
                .as_deref()
                .unwrap_or(DEFAULT_IMAGE_MODEL_FILE),
        );
        let text_model_path = root.join(
            manifest
                .text_model_file
                .as_deref()
                .unwrap_or(DEFAULT_TEXT_MODEL_FILE),
        );

        for (path, label) in [
            (&image_model_path, "图像 ONNX 模型"),
            (&text_model_path, "文本 ONNX 模型"),
        ] {
            if !path.exists() {
                return Err(format!("模型目录缺少 {label}"));
            }
        }

        ResolvedModelFiles::Split {
            image_model_path,
            text_model_path,
        }
    };

    let vocab_path = root.join(manifest.vocab_file.as_deref().unwrap_or(DEFAULT_VOCAB_FILE));
    let tokenizer_config_path = root.join(
        manifest
            .tokenizer_config_file
            .as_deref()
            .unwrap_or(DEFAULT_TOKENIZER_CONFIG_FILE),
    );
    let preprocessor_config_path = manifest
        .preprocessor_config_file
        .as_deref()
        .map(|value| root.join(value));

    for (path, label) in [
        (&vocab_path, "vocab.txt"),
        (&tokenizer_config_path, "tokenizer_config.json"),
    ] {
        if !path.exists() {
            return Err(format!("模型目录缺少 {label}"));
        }
    }

    if let Some(preprocessor_config_path) = preprocessor_config_path.as_ref() {
        if !preprocessor_config_path.exists() {
            return Err(format!(
                "模型目录缺少 {}",
                preprocessor_config_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(DEFAULT_PREPROCESSOR_CONFIG_FILE)
            ));
        }
    }

    let do_lower_case = load_tokenizer_do_lower_case(&tokenizer_config_path)?;
    let image_size = if let Some(preprocessor_config_path) = preprocessor_config_path.as_ref() {
        load_preprocessor_image_size(preprocessor_config_path)?
    } else {
        manifest.image_size.unwrap_or(DEFAULT_IMAGE_SIZE)
    };

    let resolved = ResolvedModelPaths {
        root: fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()),
        manifest_path: Some(manifest_path),
        model_files,
        vocab_path,
        tokenizer_config_path,
        preprocessor_config_path,
        manifest,
        image_size,
        do_lower_case,
    };

    verify_model_hashes(&resolved)?;

    Ok(Some(resolved))
}

fn try_resolve_huggingface_layout(root: &Path) -> Result<Option<ResolvedModelPaths>, String> {
    let config_path = root.join(DEFAULT_HUGGINGFACE_CONFIG_FILE);
    if !config_path.exists() {
        return Ok(None);
    }

    let config_content =
        fs::read_to_string(&config_path).map_err(|e| format!("无法读取 config.json: {}", e))?;
    let config: HuggingFaceConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("config.json 格式无效: {}", e))?;

    if config.model_type.trim() != "chinese_clip" {
        return Err("config.json 不是 Chinese-CLIP 模型".to_string());
    }

    let (model_relative_path, model_path) = resolve_huggingface_model_file(root)?;
    let vocab_path = root.join(DEFAULT_VOCAB_FILE);
    let tokenizer_config_path = root.join(DEFAULT_TOKENIZER_CONFIG_FILE);
    let preprocessor_config_path = root.join(DEFAULT_PREPROCESSOR_CONFIG_FILE);

    for (path, label) in [
        (&vocab_path, "vocab.txt"),
        (&tokenizer_config_path, "tokenizer_config.json"),
    ] {
        if !path.exists() {
            return Err(format!("模型目录缺少 {label}"));
        }
    }

    let do_lower_case = load_tokenizer_do_lower_case(&tokenizer_config_path)?;
    let image_size = if preprocessor_config_path.exists() {
        load_preprocessor_image_size(&preprocessor_config_path)?
    } else {
        DEFAULT_IMAGE_SIZE
    };

    let base_model_id = if config.name_or_path.trim().is_empty() {
        root.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("hf-chinese-clip")
            .to_string()
    } else {
        config.name_or_path.trim().to_string()
    };
    let version = if config.transformers_version.trim().is_empty() {
        "huggingface-onnx".to_string()
    } else {
        format!("transformers-{}", config.transformers_version.trim())
    };
    let relative_model_name = model_relative_path.to_string_lossy().replace('\\', "/");
    let manifest = ModelManifest {
        model_id: format!("{base_model_id}@{relative_model_name}"),
        version,
        embedding_dim: config
            .projection_dim
            .ok_or_else(|| "config.json 缺少 projection_dim".to_string())?,
        context_length: DEFAULT_HUGGINGFACE_CONTEXT_LENGTH,
        source_url: String::new(),
        sha256: None,
        image_model_file: None,
        text_model_file: None,
        model_file: Some(relative_model_name),
        vocab_file: Some(DEFAULT_VOCAB_FILE.to_string()),
        tokenizer_config_file: Some(DEFAULT_TOKENIZER_CONFIG_FILE.to_string()),
        preprocessor_config_file: preprocessor_config_path
            .exists()
            .then_some(DEFAULT_PREPROCESSOR_CONFIG_FILE.to_string()),
        image_size: Some(image_size),
    };

    Ok(Some(ResolvedModelPaths {
        root: fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()),
        manifest_path: None,
        model_files: ResolvedModelFiles::Combined { model_path },
        vocab_path,
        tokenizer_config_path,
        preprocessor_config_path: preprocessor_config_path
            .exists()
            .then_some(preprocessor_config_path),
        manifest,
        image_size,
        do_lower_case,
    }))
}

fn validate_manifest(manifest: &ModelManifest) -> Result<(), String> {
    if manifest.model_id.trim().is_empty() {
        return Err("manifest.json 缺少 model_id".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("manifest.json 缺少 version".to_string());
    }
    if manifest.embedding_dim == 0 {
        return Err("manifest.json 的 embedding_dim 无效".to_string());
    }
    if manifest.context_length == 0 {
        return Err("manifest.json 的 context_length 无效".to_string());
    }

    Ok(())
}

fn resolve_huggingface_model_file(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let onnx_dir = root.join(DEFAULT_HUGGINGFACE_ONNX_DIR);
    if !onnx_dir.is_dir() {
        return Err("模型目录缺少 onnx 子目录".to_string());
    }

    for file_name in HUGGINGFACE_MODEL_FILE_PREFERENCES {
        let path = onnx_dir.join(file_name);
        if path.exists() {
            return Ok((
                PathBuf::from(DEFAULT_HUGGINGFACE_ONNX_DIR).join(file_name),
                path,
            ));
        }
    }

    let mut discovered = fs::read_dir(&onnx_dir)
        .map_err(|e| format!("无法读取 onnx 目录: {}", e))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("onnx"))
        })
        .collect::<Vec<_>>();
    discovered.sort();

    if let Some(path) = discovered.into_iter().next() {
        let relative_path = path
            .strip_prefix(root)
            .map(Path::to_path_buf)
            .unwrap_or_else(|_| {
                PathBuf::from(DEFAULT_HUGGINGFACE_ONNX_DIR).join(DEFAULT_COMBINED_MODEL_FILE)
            });
        return Ok((relative_path, path));
    }

    Err("onnx 目录中没有可用的 ONNX 模型文件".to_string())
}

fn collect_missing_files(root: &Path) -> Vec<String> {
    if root.join(DEFAULT_MANIFEST_FILE).exists() {
        return [
            DEFAULT_MANIFEST_FILE,
            DEFAULT_IMAGE_MODEL_FILE,
            DEFAULT_TEXT_MODEL_FILE,
            DEFAULT_VOCAB_FILE,
            DEFAULT_TOKENIZER_CONFIG_FILE,
        ]
        .into_iter()
        .filter(|name| !root.join(name).exists())
        .map(str::to_string)
        .collect();
    }

    let mut missing_files = Vec::new();
    for name in [
        DEFAULT_HUGGINGFACE_CONFIG_FILE,
        DEFAULT_VOCAB_FILE,
        DEFAULT_TOKENIZER_CONFIG_FILE,
    ] {
        if !root.join(name).exists() {
            missing_files.push(name.to_string());
        }
    }

    let has_onnx_model = root.join(DEFAULT_HUGGINGFACE_ONNX_DIR).is_dir()
        && HUGGINGFACE_MODEL_FILE_PREFERENCES.iter().any(|file_name| {
            root.join(DEFAULT_HUGGINGFACE_ONNX_DIR)
                .join(file_name)
                .exists()
        });
    if !has_onnx_model {
        missing_files.push("onnx/<model>.onnx".to_string());
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

fn load_tokenizer_do_lower_case(tokenizer_config_path: &Path) -> Result<bool, String> {
    let content = fs::read_to_string(tokenizer_config_path).map_err(|e| {
        format!(
            "无法读取 tokenizer_config.json '{}': {}",
            tokenizer_config_path.display(),
            e
        )
    })?;
    let config: HuggingFaceTokenizerConfig = serde_json::from_str(&content).map_err(|e| {
        format!(
            "tokenizer_config.json 格式无效 '{}': {}",
            tokenizer_config_path.display(),
            e
        )
    })?;
    Ok(config.do_lower_case)
}

fn load_preprocessor_image_size(preprocessor_config_path: &Path) -> Result<usize, String> {
    let content = fs::read_to_string(preprocessor_config_path).map_err(|e| {
        format!(
            "无法读取 preprocessor_config.json '{}': {}",
            preprocessor_config_path.display(),
            e
        )
    })?;
    let config: HuggingFacePreprocessorConfig = serde_json::from_str(&content).map_err(|e| {
        format!(
            "preprocessor_config.json 格式无效 '{}': {}",
            preprocessor_config_path.display(),
            e
        )
    })?;

    Ok(config
        .size
        .as_ref()
        .and_then(ImageSizeValue::resolve)
        .or_else(|| config.crop_size.as_ref().and_then(ImageSizeValue::resolve))
        .unwrap_or(DEFAULT_IMAGE_SIZE))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|e| format!("无法读取 '{}' 进行校验: {}", path.display(), e))?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_huggingface_layout_prefers_quantized_model() {
        let root = std::env::temp_dir().join(format!(
            "shiguang-hf-model-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let onnx_dir = root.join("onnx");
        std::fs::create_dir_all(&onnx_dir).unwrap();

        std::fs::write(
            root.join("config.json"),
            r#"{
  "_name_or_path": "OFA-Sys/chinese-clip-vit-base-patch16",
  "model_type": "chinese_clip",
  "projection_dim": 512,
  "transformers_version": "4.36.0"
}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("tokenizer_config.json"),
            r#"{"do_lower_case": true}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("preprocessor_config.json"),
            r#"{"size":{"height":224,"width":224}}"#,
        )
        .unwrap();
        std::fs::write(root.join("vocab.txt"), "[PAD]\n[UNK]\n[CLS]\n[SEP]\n").unwrap();
        std::fs::write(onnx_dir.join("model.onnx"), b"placeholder").unwrap();
        std::fs::write(onnx_dir.join("model_quantized.onnx"), b"placeholder").unwrap();

        let resolved = resolve_model_paths(root.to_string_lossy().as_ref()).unwrap();
        let selected_model = match resolved.model_files {
            ResolvedModelFiles::Combined { model_path } => model_path,
            ResolvedModelFiles::Split { .. } => panic!("expected combined model layout"),
        };

        assert!(selected_model.ends_with(Path::new("onnx").join("model_quantized.onnx")));
        assert_eq!(resolved.manifest.embedding_dim, 512);
        assert_eq!(resolved.manifest.context_length, 52);
        assert_eq!(resolved.image_size, 224);
        assert!(resolved.do_lower_case);

        let _ = std::fs::remove_dir_all(root);
    }
}
