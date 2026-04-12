pub mod fgclip2;
pub mod image_preprocess;
pub mod model_manager;

use self::fgclip2::FgClip2Model;
use self::model_manager::ResolvedModelPaths;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct VisualModelRuntime {
    loaded_root: Option<PathBuf>,
    model: Option<FgClip2Model>,
    last_used_at: Option<Instant>,
    active_visual_tasks: usize,
}

impl VisualModelRuntime {
    pub fn get_or_load(
        &mut self,
        resolved_model: &ResolvedModelPaths,
    ) -> Result<&mut FgClip2Model, String> {
        let needs_reload = self
            .loaded_root
            .as_ref()
            .map(|loaded_root| loaded_root != &resolved_model.root)
            .unwrap_or(true);

        if needs_reload {
            self.model = Some(FgClip2Model::load(resolved_model)?);
            self.loaded_root = Some(resolved_model.root.clone());
        }

        self.model
            .as_mut()
            .ok_or_else(|| "无法初始化本地视觉搜索模型".to_string())
    }

    pub fn encode_text(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        text: &str,
    ) -> Result<Vec<f32>, String> {
        let embedding = self.get_or_load(resolved_model)?.encode_text(text)?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding)
    }

    pub fn encode_image_path(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        path: &std::path::Path,
    ) -> Result<Vec<f32>, String> {
        let embedding = self.get_or_load(resolved_model)?.encode_image_path(path)?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding)
    }

    pub fn encode_image_bytes(
        &mut self,
        resolved_model: &ResolvedModelPaths,
        bytes: &[u8],
    ) -> Result<Vec<f32>, String> {
        let embedding = self.get_or_load(resolved_model)?.encode_image_bytes(bytes)?;
        self.last_used_at = Some(Instant::now());
        Ok(embedding)
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
        self.loaded_root = None;
        self.model = None;
        self.last_used_at = None;
    }
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
