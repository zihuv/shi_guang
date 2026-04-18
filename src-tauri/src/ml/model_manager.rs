use crate::db::Database;
use omni_search::{probe_local_model_dir, ProviderPolicy, RuntimeConfig, RuntimeDevice};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const VISUAL_SEARCH_SETTING_KEY: &str = "visualSearch";
pub const AI_AUTO_ANALYZE_ON_IMPORT_SETTING_KEY: &str = "aiAutoAnalyzeOnImport";

const VISUAL_MODEL_SEARCH_ROOTS: [&str; 2] = [".debug-models", "omni_search/models"];
const VISUAL_MODEL_DIR_ENV: &str = "SHIGUANG_VISUAL_MODEL_DIR";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisualSearchRuntimeDevice {
    #[default]
    #[serde(alias = "Auto")]
    Auto,
    #[serde(alias = "Cpu")]
    Cpu,
    #[serde(alias = "Gpu")]
    Gpu,
}

impl From<VisualSearchRuntimeDevice> for RuntimeDevice {
    fn from(value: VisualSearchRuntimeDevice) -> Self {
        match value {
            VisualSearchRuntimeDevice::Auto => RuntimeDevice::Auto,
            VisualSearchRuntimeDevice::Cpu => RuntimeDevice::Cpu,
            VisualSearchRuntimeDevice::Gpu => RuntimeDevice::Gpu,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisualSearchProviderPolicy {
    #[serde(alias = "Auto")]
    Auto,
    #[default]
    #[serde(alias = "Interactive")]
    Interactive,
    #[serde(alias = "Service")]
    Service,
}

impl From<VisualSearchProviderPolicy> for ProviderPolicy {
    fn from(value: VisualSearchProviderPolicy) -> Self {
        match value {
            VisualSearchProviderPolicy::Auto => ProviderPolicy::Auto,
            VisualSearchProviderPolicy::Interactive => ProviderPolicy::Interactive,
            VisualSearchProviderPolicy::Service => ProviderPolicy::Service,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisualSearchThreadPreset {
    #[serde(alias = "Auto")]
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum VisualSearchThreadConfig {
    Preset(VisualSearchThreadPreset),
    Fixed(usize),
}

impl Default for VisualSearchThreadConfig {
    fn default() -> Self {
        Self::Preset(VisualSearchThreadPreset::Auto)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualSearchRuntimeConfig {
    #[serde(default)]
    pub device: VisualSearchRuntimeDevice,
    #[serde(default)]
    pub provider_policy: VisualSearchProviderPolicy,
    #[serde(default)]
    pub intra_threads: Option<VisualSearchThreadConfig>,
    #[serde(default)]
    pub fgclip_max_patches: Option<usize>,
}

impl Default for VisualSearchRuntimeConfig {
    fn default() -> Self {
        Self {
            device: VisualSearchRuntimeDevice::Auto,
            provider_policy: VisualSearchProviderPolicy::Interactive,
            intra_threads: Some(VisualSearchThreadConfig::default()),
            fgclip_max_patches: None,
        }
    }
}

impl VisualSearchRuntimeConfig {
    pub fn resolve_runtime_config(&self) -> Result<RuntimeConfig, String> {
        let mut builder = RuntimeConfig::builder();
        builder.device(self.device.into());
        builder.provider_policy(self.provider_policy.into());

        if let Some(VisualSearchThreadConfig::Fixed(intra_threads)) = self.intra_threads.as_ref() {
            builder.intra_threads(*intra_threads);
        }
        if let Some(fgclip_max_patches) = self.fgclip_max_patches {
            builder.fgclip_max_patches(fgclip_max_patches);
        }

        builder.build().map_err(|error| error.to_string())
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
    #[serde(default)]
    pub process_unindexed_only: bool,
    #[serde(default)]
    pub runtime: VisualSearchRuntimeConfig,
}

impl Default for VisualSearchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            model_path: String::new(),
            auto_vectorize_on_import: false,
            process_unindexed_only: true,
            runtime: VisualSearchRuntimeConfig::default(),
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

#[derive(Debug, Clone)]
pub struct ModelManifest {
    pub model_id: String,
    pub version: String,
    pub model_type: String,
    pub embedding_dim: usize,
    pub context_length: usize,
}

#[derive(Debug, Clone)]
pub struct ResolvedModelPaths {
    pub root: PathBuf,
    pub manifest_path: PathBuf,
    pub manifest: ModelManifest,
}

pub fn load_visual_search_config(db: &Database) -> Result<VisualSearchConfig, String> {
    let raw_value = match db
        .get_setting(VISUAL_SEARCH_SETTING_KEY)
        .map_err(|e| e.to_string())?
    {
        Some(value) => value,
        None => return Ok(VisualSearchConfig::default()),
    };

    let mut config: VisualSearchConfig =
        serde_json::from_str(&raw_value).map_err(|e| format!("解析本地视觉搜索配置失败: {}", e))?;

    if config.model_path.trim().is_empty() {
        if let Some(recommended_path) = find_recommended_visual_model_path() {
            config.model_path = recommended_path;
        }
    }

    Ok(config)
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

        for relative_dir in VISUAL_MODEL_SEARCH_ROOTS {
            let candidate_root = root.join(relative_dir);
            if !candidate_root.is_dir() {
                continue;
            }

            if let Some(path) = find_first_valid_model_dir(&candidate_root) {
                return Some(path);
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
            message: "请先选择视觉搜索模型目录".to_string(),
            normalized_model_path,
            model_id: None,
            version: None,
            embedding_dim: None,
            context_length: None,
            missing_files: Vec::new(),
        };
    }

    let probe = probe_local_model_dir(Path::new(&normalized_model_path));
    let resolved_path = canonical_path(&probe.normalized_path);
    VisualModelValidationResult {
        valid: probe.ok,
        message: probe
            .error
            .unwrap_or_else(|| "视觉搜索模型目录可用".to_string()),
        normalized_model_path: resolved_path.to_string_lossy().to_string(),
        model_id: probe.model_id,
        version: probe.model_revision,
        embedding_dim: probe.embedding_dim,
        context_length: probe.context_length,
        missing_files: probe
            .missing_files
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
    }
}

pub fn resolve_model_paths(model_path: &str) -> Result<ResolvedModelPaths, String> {
    let trimmed = model_path.trim();
    if trimmed.is_empty() {
        return Err("请先选择视觉搜索模型目录".to_string());
    }

    let probe = probe_local_model_dir(Path::new(trimmed));
    if !probe.ok {
        return Err(probe
            .error
            .unwrap_or_else(|| "视觉搜索模型目录不可用".to_string()));
    }

    let model_id = probe
        .model_id
        .ok_or_else(|| "模型目录缺少 model_id".to_string())?;
    let version = probe
        .model_revision
        .ok_or_else(|| "模型目录缺少 model_revision".to_string())?;
    let embedding_dim = probe
        .embedding_dim
        .ok_or_else(|| "模型目录缺少 embedding_dim".to_string())?;
    let context_length = probe
        .context_length
        .ok_or_else(|| "模型目录缺少 context_length".to_string())?;
    let model_type = probe
        .family
        .map(|family| family.to_string())
        .ok_or_else(|| "模型目录缺少 family".to_string())?;

    Ok(ResolvedModelPaths {
        root: canonical_path(&probe.normalized_path),
        manifest_path: canonical_path(&probe.manifest_path),
        manifest: ModelManifest {
            model_id,
            version,
            model_type,
            embedding_dim,
            context_length,
        },
    })
}

fn canonical_string(path: &Path) -> String {
    canonical_path(path).to_string_lossy().to_string()
}

fn canonical_path(path: &Path) -> PathBuf {
    normalize_path_for_display(fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()))
}

#[cfg(windows)]
fn normalize_path_for_display(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(stripped) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

#[cfg(not(windows))]
fn normalize_path_for_display(path: PathBuf) -> PathBuf {
    path
}

fn find_first_valid_model_dir(search_root: &Path) -> Option<String> {
    if resolve_model_paths(search_root.to_string_lossy().as_ref()).is_ok() {
        return Some(canonical_string(search_root));
    }

    let mut children = fs::read_dir(search_root)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    children.sort();

    children.into_iter().find_map(|candidate| {
        if resolve_model_paths(candidate.to_string_lossy().as_ref()).is_ok() {
            Some(canonical_string(&candidate))
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use omni_search::{ProviderPolicy, RuntimeDevice};

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

    fn write_minimal_omni_fgclip_model_dir(root: &Path) {
        std::fs::write(root.join("text.onnx"), b"text").unwrap();
        std::fs::write(root.join("visual.onnx"), b"image").unwrap();
        std::fs::write(root.join("tokenizer.json"), b"{}").unwrap();
        std::fs::write(root.join("text_token_embedding.bin"), b"embed").unwrap();
        std::fs::write(root.join("vision_pos_embedding.bin"), b"pos").unwrap();
        std::fs::write(
            root.join("model_config.json"),
            r#"{
                "format": "omni_flat_v1",
                "schema_version": 1,
                "family": "fg_clip",
                "model_id": "fgclip2-base",
                "model_revision": "2026-04-13",
                "embedding_dim": 768,
                "normalize_output": true,
                "text": {
                  "onnx": "text.onnx",
                  "output_name": "text_features",
                  "tokenizer": "tokenizer.json",
                  "context_length": 64,
                  "input": { "kind": "token_embeds" },
                  "token_embedding": {
                    "file": "text_token_embedding.bin",
                    "dtype": "f16",
                    "embedding_dim": 768
                  }
                },
                "image": {
                  "onnx": "visual.onnx",
                  "output_name": "image_features",
                  "preprocess": {
                    "kind": "fgclip_patch_tokens",
                    "patch_size": 16,
                    "default_max_patches": 1024,
                    "vision_pos_embedding": "vision_pos_embedding.bin"
                  }
                }
            }"#,
        )
        .unwrap();
    }

    #[test]
    fn resolves_omni_model_dir_layout() {
        let root = unique_temp_dir("omni-model-dir");
        std::fs::create_dir_all(&root).unwrap();
        write_minimal_omni_fgclip_model_dir(&root);

        let resolved = resolve_model_paths(root.to_string_lossy().as_ref()).unwrap();
        assert_eq!(
            resolved.root,
            normalize_path_for_display(std::fs::canonicalize(&root).unwrap())
        );
        assert_eq!(resolved.manifest.model_id, "fgclip2-base");
        assert_eq!(resolved.manifest.version, "2026-04-13");
        assert_eq!(resolved.manifest.model_type, "fgclip");
        assert_eq!(resolved.manifest.embedding_dim, 768);
        assert_eq!(resolved.manifest.context_length, 64);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_missing_manifest() {
        let root = unique_temp_dir("missing-manifest");
        std::fs::create_dir_all(&root).unwrap();

        let error = resolve_model_paths(root.to_string_lossy().as_ref()).unwrap_err();
        assert!(error.contains("missing model_config.json"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn visual_runtime_config_uses_sdk_defaults_when_empty() {
        let runtime = VisualSearchRuntimeConfig::default()
            .resolve_runtime_config()
            .unwrap();

        let mut expected = RuntimeConfig::default();
        expected.provider_policy = ProviderPolicy::Interactive;

        assert_eq!(runtime, expected);
    }

    #[test]
    fn visual_runtime_config_applies_overrides() {
        let runtime = VisualSearchRuntimeConfig {
            device: VisualSearchRuntimeDevice::Gpu,
            provider_policy: VisualSearchProviderPolicy::Service,
            intra_threads: Some(VisualSearchThreadConfig::Fixed(2)),
            fgclip_max_patches: Some(256),
        }
        .resolve_runtime_config()
        .unwrap();

        assert_eq!(runtime.device, RuntimeDevice::Gpu);
        assert_eq!(runtime.provider_policy, ProviderPolicy::Service);
        assert_eq!(runtime.intra_threads, 2);
        assert_eq!(runtime.fgclip_max_patches, Some(256));
    }

    #[test]
    fn visual_runtime_config_accepts_explicit_auto_values() {
        let runtime: VisualSearchRuntimeConfig = serde_json::from_str(
            r#"{
                "device": "auto",
                "providerPolicy": "interactive",
                "intraThreads": "auto",
                "fgclipMaxPatches": 576,
                "sessionPolicy": "keep_both_loaded"
            }"#,
        )
        .unwrap();

        let resolved = runtime.resolve_runtime_config().unwrap();

        assert_eq!(resolved.device, RuntimeDevice::Auto);
        assert_eq!(resolved.provider_policy, ProviderPolicy::Interactive);
        assert_eq!(
            resolved.intra_threads,
            RuntimeConfig::default().intra_threads
        );
        assert_eq!(resolved.fgclip_max_patches, Some(576));
    }

    #[test]
    fn visual_runtime_config_treats_null_threads_as_auto() {
        let runtime: VisualSearchRuntimeConfig = serde_json::from_str(
            r#"{
                "device": "cpu",
                "providerPolicy": "service",
                "intraThreads": null
            }"#,
        )
        .unwrap();

        let resolved = runtime.resolve_runtime_config().unwrap();

        assert_eq!(resolved.device, RuntimeDevice::Cpu);
        assert_eq!(resolved.provider_policy, ProviderPolicy::Service);
        assert_eq!(
            resolved.intra_threads,
            RuntimeConfig::default().intra_threads
        );
    }

    #[test]
    fn visual_runtime_config_defaults_provider_policy_to_interactive() {
        let runtime: VisualSearchRuntimeConfig = serde_json::from_str(r#"{}"#).unwrap();

        assert_eq!(
            runtime.provider_policy,
            VisualSearchProviderPolicy::Interactive
        );
    }

    #[test]
    fn visual_runtime_config_rejects_invalid_thread_counts() {
        let error = VisualSearchRuntimeConfig {
            intra_threads: Some(VisualSearchThreadConfig::Fixed(0)),
            ..Default::default()
        }
        .resolve_runtime_config()
        .unwrap_err();

        assert!(error.contains("runtime.intra_threads must be greater than 0"));
    }

    #[cfg(windows)]
    #[test]
    fn strips_windows_verbatim_prefix_from_display_path() {
        assert_eq!(
            normalize_path_for_display(PathBuf::from(
                r"\\?\D:\code\omni_search\models\fgclip2_flat"
            )),
            PathBuf::from(r"D:\code\omni_search\models\fgclip2_flat")
        );
        assert_eq!(
            normalize_path_for_display(PathBuf::from(r"\\?\UNC\server\share\models")),
            PathBuf::from(r"\\server\share\models")
        );
    }
}
