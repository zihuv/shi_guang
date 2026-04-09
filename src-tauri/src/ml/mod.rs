pub mod fgclip2;
pub mod image_preprocess;
pub mod model_manager;

use self::fgclip2::FgClip2Model;
use self::model_manager::ResolvedModelPaths;
use std::path::PathBuf;

#[derive(Default)]
pub struct VisualModelRuntime {
    loaded_root: Option<PathBuf>,
    model: Option<FgClip2Model>,
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

    pub fn clear(&mut self) {
        self.loaded_root = None;
        self.model = None;
    }
}
