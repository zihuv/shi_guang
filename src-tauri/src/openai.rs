#![allow(dead_code)]

use crate::db::{Database, FileWithTags, Tag};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::Value;
use tokio::time::{Duration, sleep};

const AI_CONFIG_SETTING_KEY: &str = "aiConfig";
const MAX_EXISTING_TAGS_IN_PROMPT: usize = 200;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub multimodal_model: String,
    pub embedding_model: Option<String>,
    pub reranker_model: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AiMetadataSuggestion {
    pub filename: String,
    pub tags: Vec<String>,
    pub description: String,
}

#[derive(Debug, Clone)]
pub struct EmbeddingRequest {
    pub input: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RerankRequest {
    pub query: String,
    pub documents: Vec<String>,
    pub top_n: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct RerankResult {
    pub index: usize,
    pub relevance_score: f32,
}

pub fn load_ai_config(db: &Database) -> Result<AiConfig, String> {
    let raw = db
        .get_setting(AI_CONFIG_SETTING_KEY)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "请先在设置中填写 AI 配置".to_string())?;
    let config: AiConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    if config.base_url.trim().is_empty()
        || config.api_key.trim().is_empty()
        || config.multimodal_model.trim().is_empty()
    {
        return Err("AI 配置不完整，请填写 Base URL、API Key 和多模态模型".to_string());
    }

    Ok(config)
}

fn build_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn build_api_url(base_url: &str, path: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with(path) {
        trimmed.to_string()
    } else {
        format!("{trimmed}/{path}")
    }
}

fn embedding_model(config: &AiConfig) -> Result<&str, String> {
    config
        .embedding_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置 Embedding 模型".to_string())
}

fn reranker_model(config: &AiConfig) -> Result<&str, String> {
    config
        .reranker_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置 Reranker 模型".to_string())
}

async fn post_json(config: &AiConfig, url: String, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", config.api_key.trim()))
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("请求 AI 服务失败: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("AI 服务返回错误: {}", response_text));
    }

    serde_json::from_str(&response_text).map_err(|e| format!("解析 AI 响应失败: {}", e))
}

fn extract_message_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(extract_text_part)
                .collect::<Vec<_>>()
                .join("\n");
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Object(_) => extract_text_part(content),
        _ => None,
    }
}

fn extract_text_part(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(extract_text_part) {
                return Some(text);
            }
            if let Some(text) = map.get("value").and_then(extract_text_part) {
                return Some(text);
            }
            None
        }
        _ => None,
    }
}

fn truncate_for_error(value: &serde_json::Value, max_chars: usize) -> String {
    let text = value.to_string();
    let mut truncated = text.chars().take(max_chars).collect::<String>();
    if text.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}

fn extract_response_text(payload: &Value) -> Option<String> {
    let first_choice = payload
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first());

    if let Some(content) = first_choice
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(extract_message_text)
    {
        return Some(content);
    }

    if let Some(text) = first_choice
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("text"))
        .and_then(extract_message_text)
    {
        return Some(text);
    }

    if let Some(text) = first_choice
        .and_then(|choice| choice.get("text"))
        .and_then(extract_message_text)
    {
        return Some(text);
    }

    if let Some(text) = payload.get("output_text").and_then(extract_message_text) {
        return Some(text);
    }

    payload
        .get("output")
        .and_then(|output| output.as_array())
        .and_then(|items| {
            let text = items
                .iter()
                .flat_map(|item| {
                    item.get("content")
                        .and_then(|content| content.as_array())
                        .into_iter()
                        .flatten()
                })
                .filter_map(extract_text_part)
                .collect::<Vec<_>>()
                .join("\n");
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
}

fn build_empty_content_error(payload: &Value) -> String {
    let first_choice = payload
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first());
    let finish_reason = first_choice
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let refusal = first_choice
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("refusal"))
        .and_then(extract_message_text);

    match refusal {
        Some(refusal_text) => format!(
            "AI 响应缺少内容，finish_reason={finish_reason}，refusal={refusal_text}"
        ),
        None => format!(
            "AI 响应缺少内容，finish_reason={finish_reason}，payload={}",
            truncate_for_error(payload, 500)
        ),
    }
}

fn should_retry_metadata_error(error: &str) -> bool {
    error.contains("AI 响应缺少内容")
        || error.contains("AI 响应缺少 JSON")
        || error.contains("解析 AI JSON 失败")
}

async fn request_image_metadata_once(
    config: &AiConfig,
    file: &FileWithTags,
    existing_tags: &[Tag],
    image_data_url: &str,
) -> Result<AiMetadataSuggestion, String> {
    let existing_tag_names = existing_tags
        .iter()
        .map(|tag| tag.name.clone())
        .take(MAX_EXISTING_TAGS_IN_PROMPT)
        .collect::<Vec<_>>();

    let system_prompt =
        "你是素材库整理助手。请根据图片内容生成适合真实文件系统的名称、标签和备注。只返回 JSON，不要输出额外解释。";
    let user_prompt = format!(
        "请分析这张图片并返回 JSON，格式为 {{\"filename\":\"...\",\"tags\":[\"...\"],\"description\":\"...\"}}。\n规则：\n1. filename 是文件名主体，不含扩展名，不含路径，避免空泛词，长度尽量简洁，不能包含 \\\\/:*?\"<>|。\n2. tags 返回 1 到 5 个短标签，优先复用已有标签；如果现有标签都不合适，可以创建新标签。\n3. description 是备注，中文优先，控制在 200 字以内。\n4. 结合图片实际内容，不要编造看不见的信息。\n当前文件名：{}\n当前已有标签：{}\n可优先复用的标签池：{}",
        file.name,
        if file.tags.is_empty() {
            "无".to_string()
        } else {
            file.tags
                .iter()
                .map(|tag| tag.name.as_str())
                .collect::<Vec<_>>()
                .join("、")
        },
        if existing_tag_names.is_empty() {
            "无".to_string()
        } else {
            existing_tag_names.join("、")
        }
    );

    let body = serde_json::json!({
        "model": config.multimodal_model,
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": user_prompt },
                    { "type": "image_url", "image_url": { "url": image_data_url } }
                ]
            }
        ],
        "enable_thinking": false,
        "stream": false,
        "temperature": 0.2,
        "max_tokens": 500
    });

    let payload = post_json(config, build_chat_completions_url(&config.base_url), body).await?;
    let content =
        extract_response_text(&payload).ok_or_else(|| build_empty_content_error(&payload))?;

    let json_text = extract_first_json_object(&content)?;
    serde_json::from_str(json_text).map_err(|e| format!("解析 AI JSON 失败: {}", e))
}

fn extract_first_json_object(text: &str) -> Result<&str, String> {
    let start = text
        .find('{')
        .ok_or_else(|| "AI 响应缺少 JSON".to_string())?;
    let end = text
        .rfind('}')
        .ok_or_else(|| "AI 响应缺少 JSON".to_string())?;
    if end < start {
        return Err("AI 响应 JSON 格式无效".to_string());
    }
    Ok(&text[start..=end])
}

pub async fn request_image_metadata(
    config: &AiConfig,
    file: &FileWithTags,
    existing_tags: &[Tag],
    image_data_url: &str,
) -> Result<AiMetadataSuggestion, String> {
    let mut last_error = None;

    for attempt in 0..2 {
        match request_image_metadata_once(config, file, existing_tags, image_data_url).await {
            Ok(result) => return Ok(result),
            Err(error) if attempt == 0 && should_retry_metadata_error(&error) => {
                last_error = Some(error);
                sleep(Duration::from_millis(250)).await;
            }
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| "AI 请求失败".to_string()))
}

pub async fn create_embeddings(
    config: &AiConfig,
    request: EmbeddingRequest,
) -> Result<Vec<Vec<f32>>, String> {
    if request.input.is_empty() {
        return Ok(Vec::new());
    }

    let body = serde_json::json!({
        "model": embedding_model(config)?,
        "input": request.input,
        "encoding_format": "float"
    });

    let payload = post_json(config, build_api_url(&config.base_url, "embeddings"), body).await?;
    let items = payload
        .get("data")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Embedding 响应缺少 data".to_string())?;

    items
        .iter()
        .map(|item| {
            let embedding = item
                .get("embedding")
                .and_then(|value| value.as_array())
                .ok_or_else(|| "Embedding 响应缺少 embedding".to_string())?;
            embedding
                .iter()
                .map(|value| {
                    value
                        .as_f64()
                        .map(|number| number as f32)
                        .ok_or_else(|| "Embedding 向量含有非数字值".to_string())
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .collect()
}

pub async fn rerank_documents(
    config: &AiConfig,
    request: RerankRequest,
) -> Result<Vec<RerankResult>, String> {
    if request.documents.is_empty() {
        return Ok(Vec::new());
    }

    let body = serde_json::json!({
        "model": reranker_model(config)?,
        "query": request.query,
        "documents": request.documents,
        "top_n": request.top_n.unwrap_or(5),
        "return_documents": false
    });

    let payload = post_json(config, build_api_url(&config.base_url, "rerank"), body).await?;
    let results = payload
        .get("results")
        .or_else(|| payload.get("data"))
        .and_then(|value| value.as_array())
        .ok_or_else(|| "Rerank 响应缺少 results/data".to_string())?;

    results
        .iter()
        .map(|item| {
            let index = item
                .get("index")
                .or_else(|| item.get("document_index"))
                .and_then(|value| value.as_u64())
                .ok_or_else(|| "Rerank 响应缺少 index".to_string())?;
            let relevance_score = item
                .get("relevance_score")
                .or_else(|| item.get("score"))
                .and_then(|value| value.as_f64())
                .ok_or_else(|| "Rerank 响应缺少 score".to_string())?;

            Ok(RerankResult {
                index: index as usize,
                relevance_score: relevance_score as f32,
            })
        })
        .collect()
}
