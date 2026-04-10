use super::image_preprocess::{preprocess_image_bytes, preprocess_image_path, FgClip2ImageInputs};
use super::model_manager::{ResolvedModelPaths, TextTokenEmbeddingDtype};
use ndarray::{Array, Array2, ArrayD, ArrayViewD, IxDyn};
use ort::{
    inputs,
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};

const VISION_POS_SOURCE_HEIGHT: usize = 16;
const VISION_POS_SOURCE_WIDTH: usize = 16;
const EMBEDDING_DIM: usize = 768;

pub struct FgClip2Model {
    text_model_path: PathBuf,
    text_token_embedding_path: PathBuf,
    text_token_embedding_dtype: TextTokenEmbeddingDtype,
    image_model_path: PathBuf,
    text_session: Option<Session>,
    image_session: Option<Session>,
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

        let vision_pos_embedding = read_f32_file(&resolved_model.vision_pos_embedding_path)?;
        let expected_pos_len = VISION_POS_SOURCE_HEIGHT * VISION_POS_SOURCE_WIDTH * EMBEDDING_DIM;
        if vision_pos_embedding.len() != expected_pos_len {
            return Err(format!(
                "vision_pos_embedding 长度异常: got {}, expected {}",
                vision_pos_embedding.len(),
                expected_pos_len
            ));
        }

        Ok(Self {
            text_model_path: resolved_model.text_model_path.clone(),
            text_token_embedding_path: resolved_model.text_token_embedding_path.clone(),
            text_token_embedding_dtype: resolved_model.text_token_embedding_dtype,
            image_model_path: resolved_model.image_model_path.clone(),
            text_session: None,
            image_session: None,
            tokenizer,
            vision_pos_embedding,
            context_length: resolved_model.manifest.context_length,
        })
    }

    pub fn encode_text(&mut self, text: &str) -> Result<Vec<f32>, String> {
        let input_ids = self.tokenize_query(text)?;
        let token_embeds = gather_text_token_embeddings(
            &self.text_token_embedding_path,
            self.text_token_embedding_dtype,
            &input_ids,
        )?;
        let token_embeds_tensor = TensorRef::from_array_view(token_embeds.view())
            .map_err(|e| format!("创建文本 token_embeds 张量失败: {}", e))?;
        let outputs = self
            .ensure_text_session()?
            .run(inputs!["token_embeds" => token_embeds_tensor])
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
            .ensure_image_session()?
            .run(inputs![
                "pixel_values" => pixel_values_tensor,
                "pixel_attention_mask" => pixel_attention_mask_tensor,
                "pos_embed" => pos_embed_tensor,
            ])
            .map_err(|e| format!("图像向量推理失败: {}", e))?;

        extract_named_output_vector(&outputs, "image_features", "图像向量")
    }

    fn ensure_text_session(&mut self) -> Result<&mut Session, String> {
        if self.text_session.is_none() {
            self.image_session = None;
            self.text_session = Some(load_session(&self.text_model_path, "文本 ONNX 模型")?);
        }

        self.text_session
            .as_mut()
            .ok_or_else(|| "无法初始化文本 ONNX 模型".to_string())
    }

    fn ensure_image_session(&mut self) -> Result<&mut Session, String> {
        if self.image_session.is_none() {
            self.text_session = None;
            self.image_session = Some(load_session(&self.image_model_path, "图像 ONNX 模型")?);
        }

        self.image_session
            .as_mut()
            .ok_or_else(|| "无法初始化图像 ONNX 模型".to_string())
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

fn gather_text_token_embeddings(
    embedding_path: &Path,
    dtype: TextTokenEmbeddingDtype,
    input_ids: &Array2<i64>,
) -> Result<ArrayD<f32>, String> {
    let input_ids = input_ids
        .as_slice()
        .ok_or_else(|| "文本 input_ids 内存布局异常".to_string())?;
    let row_bytes = dtype.bytes_per_value() * EMBEDDING_DIM;
    let token_count = fs::metadata(embedding_path)
        .map_err(|e| {
            format!(
                "无法读取文本 token embedding 元信息 '{}': {}",
                embedding_path.display(),
                e
            )
        })?
        .len()
        / row_bytes as u64;
    let mut file = File::open(embedding_path).map_err(|e| {
        format!(
            "无法打开文本 token embedding '{}': {}",
            embedding_path.display(),
            e
        )
    })?;
    let mut row_bytes_buffer = vec![0u8; row_bytes];
    let mut values = vec![0.0f32; input_ids.len() * EMBEDDING_DIM];

    for (token_index, token_id) in input_ids.iter().enumerate() {
        if *token_id < 0 || *token_id as u64 >= token_count {
            return Err(format!(
                "token id {} 超出文本 token embedding 行数 {}",
                token_id, token_count
            ));
        }

        file.seek(SeekFrom::Start(*token_id as u64 * row_bytes as u64))
            .map_err(|e| format!("读取文本 token embedding 偏移失败: {}", e))?;
        file.read_exact(&mut row_bytes_buffer)
            .map_err(|e| format!("读取文本 token embedding 失败: {}", e))?;

        let output = &mut values[token_index * EMBEDDING_DIM..(token_index + 1) * EMBEDDING_DIM];
        match dtype {
            TextTokenEmbeddingDtype::F16 => {
                for (value, bytes) in output.iter_mut().zip(row_bytes_buffer.chunks_exact(2)) {
                    *value = f16_to_f32(u16::from_le_bytes([bytes[0], bytes[1]]));
                }
            }
            TextTokenEmbeddingDtype::F32 => {
                for (value, bytes) in output.iter_mut().zip(row_bytes_buffer.chunks_exact(4)) {
                    *value = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                }
            }
        }
    }

    Array::from_shape_vec(IxDyn(&[1, input_ids.len(), EMBEDDING_DIM]), values)
        .map_err(|e| format!("构建 token_embeds 张量失败: {}", e))
}

fn f16_to_f32(bits: u16) -> f32 {
    let sign = ((bits & 0x8000) as u32) << 16;
    let exponent = (bits >> 10) & 0x1f;
    let fraction = bits & 0x03ff;

    let f32_bits = match exponent {
        0 if fraction == 0 => sign,
        0 => {
            let mut fraction = fraction as u32;
            let mut exponent = -14i32;
            while fraction & 0x0400 == 0 {
                fraction <<= 1;
                exponent -= 1;
            }
            fraction &= 0x03ff;
            sign | (((exponent + 127) as u32) << 23) | (fraction << 13)
        }
        0x1f => sign | 0x7f80_0000 | ((fraction as u32) << 13),
        _ => sign | (((exponent as u32) + 112) << 23) | ((fraction as u32) << 13),
    };
    f32::from_bits(f32_bits)
}

fn make_pos_embed_no_antialias(
    base_pos: &[f32],
    target_height: usize,
    target_width: usize,
    max_patches: usize,
) -> Result<ArrayD<f32>, String> {
    let expected_len = VISION_POS_SOURCE_HEIGHT * VISION_POS_SOURCE_WIDTH * EMBEDDING_DIM;
    if base_pos.len() != expected_len {
        return Err(format!(
            "vision position embedding 长度异常: got {}, expected {}",
            base_pos.len(),
            expected_len
        ));
    }

    let mut output = vec![0.0f32; max_patches * EMBEDDING_DIM];
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

            for channel in 0..EMBEDDING_DIM {
                let top = lerp(
                    base_pos[((y0 * VISION_POS_SOURCE_WIDTH + x0) * EMBEDDING_DIM) + channel],
                    base_pos[((y0 * VISION_POS_SOURCE_WIDTH + x1) * EMBEDDING_DIM) + channel],
                    wx,
                );
                let bottom = lerp(
                    base_pos[((y1 * VISION_POS_SOURCE_WIDTH + x0) * EMBEDDING_DIM) + channel],
                    base_pos[((y1 * VISION_POS_SOURCE_WIDTH + x1) * EMBEDDING_DIM) + channel],
                    wx,
                );
                output[token * EMBEDDING_DIM + channel] = lerp(top, bottom, wy);
            }
        }
    }

    let valid = target_height * target_width;
    if valid > 0 && valid < max_patches {
        let first_token = output[..EMBEDDING_DIM].to_vec();
        for token in valid..max_patches {
            let start = token * EMBEDDING_DIM;
            output[start..start + EMBEDDING_DIM].copy_from_slice(&first_token);
        }
    }

    Array::from_shape_vec(IxDyn(&[1, max_patches, EMBEDDING_DIM]), output)
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
