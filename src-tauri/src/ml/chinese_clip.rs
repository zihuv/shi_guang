use super::image_preprocess::{preprocess_image_bytes, preprocess_image_path};
use super::model_manager::{ResolvedModelFiles, ResolvedModelPaths};
use super::tokenizer::ChineseClipTokenizer;
use ndarray::{Array2, Array4, ArrayViewD};
use ort::{inputs, session::Session, value::TensorRef};
use std::path::Path;

enum ModelBackend {
    Split {
        text_session: Session,
        image_session: Session,
    },
    Combined {
        session: Session,
        empty_text_ids: Array2<i64>,
        empty_attention_mask: Array2<i64>,
        blank_pixel_values: Array4<f32>,
    },
}

pub struct ChineseClipModel {
    backend: ModelBackend,
    tokenizer: ChineseClipTokenizer,
    context_length: usize,
    image_size: usize,
}

impl ChineseClipModel {
    pub fn load(resolved_model: &ResolvedModelPaths) -> Result<Self, String> {
        let tokenizer = ChineseClipTokenizer::from_vocab_file(
            &resolved_model.vocab_path,
            resolved_model.do_lower_case,
        )?;

        let backend = match &resolved_model.model_files {
            ResolvedModelFiles::Split {
                text_model_path,
                image_model_path,
            } => {
                let text_session = Session::builder()
                    .map_err(|e| format!("创建文本 ONNX session 失败: {}", e))?
                    .commit_from_file(text_model_path)
                    .map_err(|e| format!("加载文本 ONNX 模型失败: {}", e))?;
                let image_session = Session::builder()
                    .map_err(|e| format!("创建图像 ONNX session 失败: {}", e))?
                    .commit_from_file(image_model_path)
                    .map_err(|e| format!("加载图像 ONNX 模型失败: {}", e))?;

                ModelBackend::Split {
                    text_session,
                    image_session,
                }
            }
            ResolvedModelFiles::Combined { model_path } => {
                let session = Session::builder()
                    .map_err(|e| format!("创建 ONNX session 失败: {}", e))?
                    .commit_from_file(model_path)
                    .map_err(|e| format!("加载 ONNX 模型失败: {}", e))?;

                let empty_text = tokenizer
                    .encode_with_attention_mask("", resolved_model.manifest.context_length);
                let empty_text_ids = Array2::<i64>::from_shape_vec(
                    (1, resolved_model.manifest.context_length),
                    empty_text.token_ids,
                )
                .map_err(|e| format!("构建空文本输入张量失败: {}", e))?;
                let empty_attention_mask = Array2::<i64>::from_shape_vec(
                    (1, resolved_model.manifest.context_length),
                    empty_text.attention_mask,
                )
                .map_err(|e| format!("构建空文本 attention mask 失败: {}", e))?;
                let blank_pixel_values = Array4::<f32>::zeros((
                    1,
                    3,
                    resolved_model.image_size,
                    resolved_model.image_size,
                ));

                ModelBackend::Combined {
                    session,
                    empty_text_ids,
                    empty_attention_mask,
                    blank_pixel_values,
                }
            }
        };

        Ok(Self {
            backend,
            tokenizer,
            context_length: resolved_model.manifest.context_length,
            image_size: resolved_model.image_size,
        })
    }

    pub fn encode_text(&mut self, text: &str) -> Result<Vec<f32>, String> {
        match &mut self.backend {
            ModelBackend::Split { text_session, .. } => {
                let token_ids = self.tokenizer.encode(text, self.context_length);
                let input = Array2::<i64>::from_shape_vec((1, self.context_length), token_ids)
                    .map_err(|e| format!("构建文本输入张量失败: {}", e))?;

                let input_tensor = TensorRef::from_array_view(input.view())
                    .map_err(|e| format!("创建文本输入张量失败: {}", e))?;
                let outputs = text_session
                    .run(inputs![input_tensor])
                    .map_err(|e| format!("文本向量推理失败: {}", e))?;

                extract_output_vector(
                    outputs[0]
                        .try_extract_array::<f32>()
                        .map_err(|e| format!("读取文本向量输出失败: {}", e))?,
                )
            }
            ModelBackend::Combined {
                session,
                blank_pixel_values,
                ..
            } => {
                let encoded_text = self
                    .tokenizer
                    .encode_with_attention_mask(text, self.context_length);
                let input_ids =
                    Array2::<i64>::from_shape_vec((1, self.context_length), encoded_text.token_ids)
                        .map_err(|e| format!("构建文本输入张量失败: {}", e))?;
                let attention_mask = Array2::<i64>::from_shape_vec(
                    (1, self.context_length),
                    encoded_text.attention_mask,
                )
                .map_err(|e| format!("构建 attention mask 失败: {}", e))?;

                let input_ids_tensor = TensorRef::from_array_view(input_ids.view())
                    .map_err(|e| format!("创建文本输入张量失败: {}", e))?;
                let attention_mask_tensor = TensorRef::from_array_view(attention_mask.view())
                    .map_err(|e| format!("创建 attention mask 失败: {}", e))?;
                let blank_pixel_values_tensor =
                    TensorRef::from_array_view(blank_pixel_values.view())
                        .map_err(|e| format!("创建空白图像张量失败: {}", e))?;
                let outputs = session
                    .run(inputs! {
                        "input_ids" => input_ids_tensor,
                        "attention_mask" => attention_mask_tensor,
                        "pixel_values" => blank_pixel_values_tensor,
                    })
                    .map_err(|e| format!("文本向量推理失败: {}", e))?;

                extract_named_output_vector(&outputs, "text_embeds", "文本向量")
            }
        }
    }

    pub fn encode_image_path(&mut self, path: &Path) -> Result<Vec<f32>, String> {
        let input = preprocess_image_path(path, self.image_size)?;
        self.encode_image_tensor(input)
    }

    pub fn encode_image_bytes(&mut self, bytes: &[u8]) -> Result<Vec<f32>, String> {
        let input = preprocess_image_bytes(bytes, self.image_size)?;
        self.encode_image_tensor(input)
    }

    fn encode_image_tensor(&mut self, input: Array4<f32>) -> Result<Vec<f32>, String> {
        match &mut self.backend {
            ModelBackend::Split { image_session, .. } => {
                let input_tensor = TensorRef::from_array_view(input.view())
                    .map_err(|e| format!("创建图像输入张量失败: {}", e))?;
                let outputs = image_session
                    .run(inputs![input_tensor])
                    .map_err(|e| format!("图像向量推理失败: {}", e))?;

                extract_output_vector(
                    outputs[0]
                        .try_extract_array::<f32>()
                        .map_err(|e| format!("读取图像向量输出失败: {}", e))?,
                )
            }
            ModelBackend::Combined {
                session,
                empty_text_ids,
                empty_attention_mask,
                ..
            } => {
                let input_ids_tensor = TensorRef::from_array_view(empty_text_ids.view())
                    .map_err(|e| format!("创建空文本输入张量失败: {}", e))?;
                let attention_mask_tensor = TensorRef::from_array_view(empty_attention_mask.view())
                    .map_err(|e| format!("创建空文本 attention mask 失败: {}", e))?;
                let input_tensor = TensorRef::from_array_view(input.view())
                    .map_err(|e| format!("创建图像输入张量失败: {}", e))?;
                let outputs = session
                    .run(inputs! {
                        "input_ids" => input_ids_tensor,
                        "attention_mask" => attention_mask_tensor,
                        "pixel_values" => input_tensor,
                    })
                    .map_err(|e| format!("图像向量推理失败: {}", e))?;

                extract_named_output_vector(&outputs, "image_embeds", "图像向量")
            }
        }
    }
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
