pub mod model_manager;

use self::model_manager::{ResolvedModelPaths, VisualSearchConfig};
use omni_search::{OmniSearch, RuntimeConfig, RuntimeSnapshot};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(windows)]
use tauri::Manager;

#[derive(Default)]
pub struct VisualModelRuntime {
    loaded_key: Option<String>,
    model: Option<OmniSearch>,
    last_used_at: Option<Instant>,
    active_visual_tasks: usize,
}

impl VisualModelRuntime {
    pub fn get_or_load(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        visual_search_config: &VisualSearchConfig,
    ) -> Result<&OmniSearch, String> {
        let runtime_config = visual_search_config.runtime.resolve_runtime_config()?;
        let model_key = build_model_key(resolved_model, &runtime_config);
        let needs_reload = self
            .loaded_key
            .as_ref()
            .map(|loaded_key| loaded_key != &model_key)
            .unwrap_or(true);

        if needs_reload {
            self.model = Some(
                OmniSearch::builder()
                    .from_local_model_dir(resolved_model.root.clone())
                    .runtime_config(runtime_config)
                    .build()
                    .map_err(|e| e.to_string())?,
            );
            self.loaded_key = Some(model_key);
        }

        self.model
            .as_ref()
            .ok_or_else(|| "无法初始化本地视觉搜索模型".to_string())
    }

    pub fn runtime_snapshot_if_loaded(
        &self,
        resolved_model: &ResolvedModelPaths,
        visual_search_config: &VisualSearchConfig,
    ) -> Result<Option<RuntimeSnapshot>, String> {
        let runtime_config = visual_search_config.runtime.resolve_runtime_config()?;
        let model_key = build_model_key(resolved_model, &runtime_config);

        if self.loaded_key.as_deref() != Some(model_key.as_str()) {
            return Ok(None);
        }

        Ok(self.model.as_ref().map(OmniSearch::runtime_snapshot))
    }

    pub fn encode_text(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        visual_search_config: &VisualSearchConfig,
        text: &str,
    ) -> Result<Vec<f32>, String> {
        let embedding = self
            .get_or_load(resolved_model, visual_search_config)?
            .embed_text(text)
            .map_err(|e| e.to_string())?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding.as_slice().to_vec())
    }

    pub fn encode_image_path(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        visual_search_config: &VisualSearchConfig,
        path: &std::path::Path,
    ) -> Result<Vec<f32>, String> {
        let embedding = self
            .get_or_load(resolved_model, visual_search_config)?
            .embed_image_path(path)
            .map_err(|e| e.to_string())?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding.as_slice().to_vec())
    }

    pub fn encode_image_bytes(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        visual_search_config: &VisualSearchConfig,
        bytes: &[u8],
    ) -> Result<Vec<f32>, String> {
        let embedding = self
            .get_or_load(resolved_model, visual_search_config)?
            .embed_image_bytes(bytes)
            .map_err(|e| e.to_string())?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding.as_slice().to_vec())
    }

    pub fn begin_visual_task(&mut self) {
        self.active_visual_tasks = self.active_visual_tasks.saturating_add(1);
    }

    pub fn end_visual_task(&mut self) {
        self.active_visual_tasks = self.active_visual_tasks.saturating_sub(1);
    }

    pub fn clear_if_idle(&mut self, idle_timeout: Duration) -> bool {
        if self.active_visual_tasks > 0 || self.model.is_none() {
            return false;
        }

        let Some(last_used_at) = self.last_used_at else {
            return false;
        };

        if last_used_at.elapsed() < idle_timeout {
            return false;
        }

        self.clear();
        true
    }

    pub fn clear(&mut self) {
        self.loaded_key = None;
        self.model = None;
        self.last_used_at = None;
    }
}

fn build_model_key(resolved_model: &ResolvedModelPaths, runtime_config: &RuntimeConfig) -> String {
    format!(
        "{}::{}::{}::device={}::provider_policy={}::intra={}::inter={:?}::fgclip_max_patches={:?}::session_policy={:?}::graph_optimization_level={:?}",
        resolved_model.root.display(),
        resolved_model.manifest.model_id,
        resolved_model.manifest.version,
        runtime_config.device,
        runtime_config.provider_policy,
        runtime_config.intra_threads,
        runtime_config.inter_threads,
        runtime_config.fgclip_max_patches,
        runtime_config.session_policy,
        runtime_config.graph_optimization_level,
    )
}

#[cfg(windows)]
pub fn preload_windows_directml(app_handle: &tauri::AppHandle) {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("DirectML.dll"));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("DirectML.dll"));
        }
    }

    candidates.dedup();

    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }

        match ort::util::preload_dylib(&candidate) {
            Ok(()) => {
                log::info!("Preloaded DirectML runtime from {}", candidate.display());
                return;
            }
            Err(error) => {
                log::warn!(
                    "Failed to preload bundled DirectML runtime {}: {}",
                    candidate.display(),
                    error
                );
            }
        }
    }

    log::warn!("No bundled DirectML.dll found; falling back to default Windows DLL resolution");
}

pub struct VisualModelTaskGuard<'a> {
    runtime: &'a Mutex<VisualModelRuntime>,
}

impl<'a> VisualModelTaskGuard<'a> {
    pub fn start(runtime: &'a Mutex<VisualModelRuntime>) -> Result<Self, String> {
        let mut guard = runtime.lock().map_err(|e| e.to_string())?;
        guard.begin_visual_task();
        drop(guard);

        Ok(Self { runtime })
    }
}

impl Drop for VisualModelTaskGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.end_visual_task();
        }
    }
}
