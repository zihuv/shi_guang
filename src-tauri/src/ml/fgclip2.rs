use super::image_preprocess::{preprocess_image_bytes, preprocess_image_path, FgClip2ImageInputs};
use super::model_manager::ResolvedModelPaths;
use ndarray::{Array, Array2, ArrayD, ArrayViewD, IxDyn};
use ort::{
    inputs,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use std::fs;
use std::path::Path;
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};

const VISION_POS_SOURCE_HEIGHT: usize = 16;
const VISION_POS_SOURCE_WIDTH: usize = 16;
const VISION_POS_CHANNELS: usize = 768;

pub struct FgClip2Model {
    text_session: Session,
    image_session: Session,
    tokenizer: Tokenizer,
    vision_pos_embedding: Vec<f32>,
    context_length: usize,
}

impl FgClip2Model {
    pub fn load(resolved_model: &ResolvedModelPaths) -> Result<Self, String> {
        let mut tokenizer =
            Tokenizer::from_file(&resolved_model.tokenizer_json_path).map_err(|e| {
                format!(
                    "加载 tokenizer.json 失败 '{}': {}",
                    resolved_model.tokenizer_json_path.display(),
                    e
                )
            })?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: resolved_model.manifest.context_length,
                ..Default::default()
            }))
            .map_err(|e| format!("配置 tokenizer 截断失败: {}", e))?;
        tokenizer.with_padding(Some(PaddingParams {
            strategy: PaddingStrategy::Fixed(resolved_model.manifest.context_length),
            pad_id: 0,
            pad_type_id: 0,
            pad_token: "<pad>".to_string(),
            ..Default::default()
        }));

        let text_session = load_session(&resolved_model.text_model_path, "文本 ONNX 模型")?;
        let image_session = load_session(&resolved_model.image_model_path, "图像 ONNX 模型")?;
        let vision_pos_embedding = read_f32_file(&resolved_model.vision_pos_embedding_path)?;
        let expected_pos_len =
            VISION_POS_SOURCE_HEIGHT * VISION_POS_SOURCE_WIDTH * VISION_POS_CHANNELS;
        if vision_pos_embedding.len() != expected_pos_len {
            return Err(format!(
                "vision_pos_embedding 长度异常: got {}, expected {}",
                vision_pos_embedding.len(),
                expected_pos_len
            ));
        }

        Ok(Self {
            text_session,
            image_session,
            tokenizer,
            vision_pos_embedding,
            context_length: resolved_model.manifest.context_length,
        })
    }

    pub fn encode_text(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let input_ids = self.tokenize_query(text)?;
        let input_ids_tensor = TensorRef::from_array_view(input_ids.view())
            .map_err(|e| format!("创建文本输入张量失败: {}", e))?;
        let outputs = self
            .text_session
            .run(inputs!["input_ids" => input_ids_tensor])
            .map_err(|e| format!("文本向量推理失败: {}", e))?;

        extract_named_output_vector(&outputs, "text_features", "文本向量")
    }

    pub fn encode_image_path(&mut self, path: &Path) -> Result<Vec<f32>, String> {
        let input = preprocess_image_path(path)?;
        self.encode_image_input(input)
    }

    pub fn encode_image_bytes(&mut self, bytes: &[u8]) -> Result<Vec<f32>, String> {
        let input = preprocess_image_bytes(bytes)?;
        self.encode_image_input(input)
    }

    fn tokenize_query(&self, text: &str) -> Result<Array2<i64>, String> {
        let normalized = text.to_lowercase();
        let encoding = self
            .tokenizer
            .encode(normalized.as_str(), true)
            .map_err(|e| format!("文本 tokenizer 失败: {}", e))?;
        let mut ids = encoding
            .get_ids()
            .iter()
            .map(|id| i64::from(*id))
            .collect::<Vec<_>>();

        if ids.len() > self.context_length {
            ids.truncate(self.context_length);
        }
        ids.resize(self.context_length, 0);

        Array2::<i64>::from_shape_vec((1, self.context_length), ids)
            .map_err(|e| format!("构建文本输入张量失败: {}", e))
    }

    fn encode_image_input(&mut self, input: FgClip2ImageInputs) -> Result<Vec<f32>, String> {
        let pos_embed = make_pos_embed_no_antialias(
            &self.vision_pos_embedding,
            input.spatial_height,
            input.spatial_width,
            input.max_patches,
        )?;

        let pixel_values_tensor = TensorRef::from_array_view(input.pixel_values.view())
            .map_err(|e| format!("创建图像 pixel_values 张量失败: {}", e))?;
        let pixel_attention_mask_tensor =
            TensorRef::from_array_view(input.pixel_attention_mask.view())
                .map_err(|e| format!("创建图像 pixel_attention_mask 张量失败: {}", e))?;
        let pos_embed_tensor = TensorRef::from_array_view(pos_embed.view())
            .map_err(|e| format!("创建图像 pos_embed 张量失败: {}", e))?;

        let outputs = self
            .image_session
            .run(inputs![
                "pixel_values" => pixel_values_tensor,
                "pixel_attention_mask" => pixel_attention_mask_tensor,
                "pos_embed" => pos_embed_tensor,
            ])
            .map_err(|e| format!("图像向量推理失败: {}", e))?;

        extract_named_output_vector(&outputs, "image_features", "图像向量")
    }
}

fn load_session(model_path: &Path, label: &str) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| format!("创建 {label} session 失败: {}", e))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| format!("配置 {label} 图优化失败: {}", e))?
        .with_intra_threads(4)
        .map_err(|e| format!("配置 {label} 推理线程失败: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("加载 {label} 失败 '{}': {}", model_path.display(), e))
}

fn read_f32_file(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = fs::read(path).map_err(|e| format!("无法读取 '{}': {}", path.display(), e))?;
    if bytes.len() % 4 != 0 {
        return Err(format!("'{}' 字节数不是 f32 的整数倍", path.display()));
    }

    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn make_pos_embed_no_antialias(
    base_pos: &[f32],
    target_height: usize,
    target_width: usize,
    max_patches: usize,
) -> Result<ArrayD<f32>, String> {
    let expected_len = VISION_POS_SOURCE_HEIGHT * VISION_POS_SOURCE_WIDTH * VISION_POS_CHANNELS;
    if base_pos.len() != expected_len {
        return Err(format!(
            "vision position embedding 长度异常: got {}, expected {}",
            base_pos.len(),
            expected_len
        ));
    }

    let mut output = vec![0.0f32; max_patches * VISION_POS_CHANNELS];
    for out_y in 0..target_height {
        let in_y = linear_source_coordinate(out_y, target_height, VISION_POS_SOURCE_HEIGHT);
        let y0 = in_y
            .floor()
            .clamp(0.0, (VISION_POS_SOURCE_HEIGHT - 1) as f32) as usize;
        let y1 = (y0 + 1).min(VISION_POS_SOURCE_HEIGHT - 1);
        let wy = in_y - y0 as f32;

        for out_x in 0..target_width {
            let in_x = linear_source_coordinate(out_x, target_width, VISION_POS_SOURCE_WIDTH);
            let x0 = in_x
                .floor()
                .clamp(0.0, (VISION_POS_SOURCE_WIDTH - 1) as f32) as usize;
            let x1 = (x0 + 1).min(VISION_POS_SOURCE_WIDTH - 1);
            let wx = in_x - x0 as f32;
            let token = out_y * target_width + out_x;

            for channel in 0..VISION_POS_CHANNELS {
                let top = lerp(
                    base_pos[((y0 * VISION_POS_SOURCE_WIDTH + x0) * VISION_POS_CHANNELS) + channel],
                    base_pos[((y0 * VISION_POS_SOURCE_WIDTH + x1) * VISION_POS_CHANNELS) + channel],
                    wx,
                );
                let bottom = lerp(
                    base_pos[((y1 * VISION_POS_SOURCE_WIDTH + x0) * VISION_POS_CHANNELS) + channel],
                    base_pos[((y1 * VISION_POS_SOURCE_WIDTH + x1) * VISION_POS_CHANNELS) + channel],
                    wx,
                );
                output[token * VISION_POS_CHANNELS + channel] = lerp(top, bottom, wy);
            }
        }
    }

    let valid = target_height * target_width;
    if valid > 0 && valid < max_patches {
        let first_token = output[..VISION_POS_CHANNELS].to_vec();
        for token in valid..max_patches {
            let start = token * VISION_POS_CHANNELS;
            output[start..start + VISION_POS_CHANNELS].copy_from_slice(&first_token);
        }
    }

    Array::from_shape_vec(IxDyn(&[1, max_patches, VISION_POS_CHANNELS]), output)
        .map_err(|e| format!("构建 pos_embed 张量失败: {}", e))
}

fn linear_source_coordinate(output_index: usize, output_size: usize, input_size: usize) -> f32 {
    let source = (output_index as f32 + 0.5) * input_size as f32 / output_size as f32 - 0.5;
    source.clamp(0.0, (input_size - 1) as f32)
}

fn lerp(a: f32, b: f32, weight: f32) -> f32 {
    a + (b - a) * weight
}

fn extract_named_output_vector(
    outputs: &ort::session::SessionOutputs<'_>,
    output_name: &str,
    label: &str,
) -> Result<Vec<f32>, String> {
    let output = outputs
        .get(output_name)
        .ok_or_else(|| format!("模型输出缺少 {output_name}"))?;
    extract_output_vector(
        output
            .try_extract_array::<f32>()
            .map_err(|e| format!("读取{label}输出失败: {}", e))?,
    )
}

fn extract_output_vector(array: ArrayViewD<'_, f32>) -> Result<Vec<f32>, String> {
    let shape = array.shape();
    if shape.len() != 2 {
        return Err(format!("模型输出维度异常: {:?}", shape));
    }
    if shape[0] != 1 {
        return Err(format!("模型输出 batch 维度异常: {}", shape[0]));
    }

    let mut vector = array.iter().copied().collect::<Vec<_>>();
    normalize_embedding(&mut vector);
    Ok(vector)
}

fn normalize_embedding(embedding: &mut [f32]) {
    let norm = embedding
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();

    if norm > 0.0 {
        for value in embedding {
            *value /= norm;
        }
    }
}
