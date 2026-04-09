#![allow(dead_code)]

use crate::db::{Database, FileWithTags, Tag};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::Value;
use tokio::time::{sleep, Duration};

const AI_CONFIG_SETTING_KEY: &str = "aiConfig";
const MAX_EXISTING_TAGS_IN_PROMPT: usize = 200;
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Clone)]
pub struct AiEndpointConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone)]
pub struct AiConfig {
    pub metadata: AiEndpointConfig,
}

#[derive(Debug, Deserialize)]
pub struct AiMetadataSuggestion {
    pub filename: String,
    pub tags: Vec<String>,
    pub description: String,
}

fn summarize_success_text(prefix: &str, text: Option<String>) -> String {
    let snippet = text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(48).collect::<String>());

    match snippet {
        Some(snippet) => format!("{prefix}，响应示例: {snippet}"),
        None => prefix.to_string(),
    }
}

fn resolve_endpoint_config(root: &Value, key: &str, legacy_model_key: &str) -> AiEndpointConfig {
    let endpoint = root.get(key).and_then(|value| value.as_object());
    let legacy_base_url = root
        .get("baseUrl")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    let legacy_api_key = root
        .get("apiKey")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();
    let legacy_model = root
        .get(legacy_model_key)
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();

    AiEndpointConfig {
        base_url: endpoint
            .and_then(|value| value.get("baseUrl"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                if legacy_base_url.is_empty() {
                    DEFAULT_OPENAI_BASE_URL
                } else {
                    legacy_base_url
                }
            })
            .to_string(),
        api_key: endpoint
            .and_then(|value| value.get("apiKey"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or(legacy_api_key)
            .to_string(),
        model: endpoint
            .and_then(|value| value.get("model"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .unwrap_or(legacy_model)
            .to_string(),
    }
}

fn parse_ai_config(db: &Database) -> Result<AiConfig, String> {
    let raw = db
        .get_setting(AI_CONFIG_SETTING_KEY)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "请先在设置中填写 AI 配置".to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    Ok(AiConfig {
        metadata: resolve_endpoint_config(&value, "metadata", "multimodalModel"),
    })
}

fn validate_endpoint_config(
    config: &AiEndpointConfig,
    name: &str,
) -> Result<AiEndpointConfig, String> {
    if config.base_url.trim().is_empty() || config.api_key.trim().is_empty() {
        return Err(format!("{name} 配置不完整，请填写 Base URL 和 API Key"));
    }

    if config.model.trim().is_empty() {
        return Err(format!("{name} 配置不完整，请填写模型"));
    }

    Ok(config.clone())
}

pub fn load_ai_config(db: &Database) -> Result<AiEndpointConfig, String> {
    let config = parse_ai_config(db)?;
    validate_endpoint_config(&config.metadata, "图片元数据分析")
}

fn build_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

async fn post_json(config: &AiEndpointConfig, url: String, body: Value) -> Result<Value, String> {
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
        Some(refusal_text) => {
            format!("AI 响应缺少内容，finish_reason={finish_reason}，refusal={refusal_text}")
        }
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
    config: &AiEndpointConfig,
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
        "model": config.model,
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
    config: &AiEndpointConfig,
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

pub async fn test_metadata_endpoint(config: &AiEndpointConfig) -> Result<String, String> {
    let body = serde_json::json!({
        "model": config.model.trim(),
        "messages": [
            {
                "role": "system",
                "content": "你是一个接口连通性测试助手。"
            },
            {
                "role": "user",
                "content": "只回复 ok"
            }
        ],
        "enable_thinking": false,
        "stream": false,
        "temperature": 0,
        "max_tokens": 16,
    });

    let payload = post_json(config, build_chat_completions_url(&config.base_url), body).await?;
    Ok(summarize_success_text(
        "图片元数据分析接口可用",
        extract_response_text(&payload),
    ))
}
