use axum::{
    body::Body,
    extract::{Query, State, Json},
    http::{HeaderMap, StatusCode, header},
    response::Response,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Emitter;

use crate::db::{Database, FileRecord};
use chrono::Local;
use image::GenericImageView;
use reqwest::Client;

#[derive(Clone)]
struct HttpServerState {
    db: Arc<Mutex<Database>>,
    client: Client,
    app_handle: AppHandle,
}

#[derive(Deserialize)]
struct ImportQuery {
    filename: Option<String>,
}

#[derive(Deserialize)]
struct ImportFromUrlQuery {
    image_url: String,
    referer: Option<String>,
}

#[derive(serde::Serialize)]
struct ImportResponse {
    success: bool,
    file_id: Option<i64>,
    error: Option<String>,
}

fn get_image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    // Try to open as image
    match image::load_from_memory(data) {
        Ok(img) => Some(img.dimensions()),
        Err(_) => None,
    }
}

fn detect_extension_from_content_type(content_type: Option<&str>) -> String {
    match content_type {
        Some(ct) => match ct {
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            "image/bmp" => "bmp",
            "image/x-icon" => "ico",
            "image/tiff" | "image/tif" => "tiff",
            _ => "png",
        },
        None => "png",
    }
    .to_string()
}

fn detect_extension_from_magic_bytes(data: &[u8]) -> String {
    if data.len() < 4 {
        return "png".to_string();
    }

    // PNG: 89 50 4E 47
    if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return "png".to_string();
    }
    // JPEG: FF D8 FF
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "jpg".to_string();
    }
    // GIF: 47 49 46 38
    if data.starts_with(&[0x47, 0x49, 0x46, 0x38]) {
        return "gif".to_string();
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        return "webp".to_string();
    }
    // BMP: 42 4D
    if data.starts_with(&[0x42, 0x4D]) {
        return "bmp".to_string();
    }
    // SVG (text-based, check for "<svg")
    if data.starts_with(b"<?xml") || data.starts_with(b"<svg") {
        return "svg".to_string();
    }

    "png".to_string()
}

fn with_cors<B>(response: Response<B>) -> Response<B> {
    let (mut parts, body) = response.into_parts();
    parts.headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    parts.headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, OPTIONS".parse().unwrap());
    parts.headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "*".parse().unwrap());
    Response::from_parts(parts, body)
}

async fn health_check() -> Response<Body> {
    let json = serde_json::json!({
        "status": "ok"
    });
    let body = serde_json::to_string(&json).unwrap();
    let response = Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();
    with_cors(response)
}

async fn import_image(
    State(state): State<HttpServerState>,
    headers: HeaderMap,
    Query(query): Query<ImportQuery>,
    body: bytes::Bytes,
) -> Result<Response<Body>, StatusCode> {
    let data = body.to_vec();

    if data.is_empty() {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some("Empty body".to_string()),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()));
    }

    // Get content type from headers
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim());

    // Determine extension
    let ext = if let Some(filename) = &query.filename {
        filename
            .rsplit('.')
            .next()
            .unwrap_or("png")
            .to_lowercase()
    } else {
        // Try to detect from content type first, then magic bytes
        detect_extension_from_content_type(content_type)
    };

    // If still not sure, check magic bytes
    let final_ext = if ext == "png" || ext.is_empty() {
        detect_extension_from_magic_bytes(&data)
    } else {
        ext
    };

    let db = state.db.lock().unwrap();

    // Get browser collection folder
    let folder = match db.get_browser_collection_folder() {
        Ok(Some(f)) => f,
        Ok(None) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some("Browser collection folder not found".to_string()),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
        Err(e) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
    };

    // Generate unique filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("browser_{}.{}", timestamp, final_ext);
    let dest_path = std::path::Path::new(&folder.path).join(&new_name);

    // Save file
    if let Err(e) = std::fs::write(&dest_path, &data) {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some(format!("Failed to write file: {}", e)),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()));
    }

    // Get image dimensions
    let (width, height) = get_image_dimensions(&data).unwrap_or((0, 0));
    let metadata = std::fs::metadata(&dest_path).ok();

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let size = metadata.map(|m| m.len() as i64).unwrap_or(data.len() as i64);

    let file_record = FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: new_name.clone(),
        ext: final_ext.clone(),
        size,
        width: width as i32,
        height: height as i32,
        folder_id: Some(folder.id),
        created_at: now.clone(),
        modified_at: now.clone(),
        imported_at: now,
        rating: 0,
        description: String::new(),
        source_url: String::new(),
        dominant_color: String::new(),
        color_distribution: String::from("[]"),
    };

    match db.insert_file(&file_record) {
        Ok(file_id) => {
            log::info!("Imported browser image: {} (id: {})", new_name, file_id);

            // Emit event to frontend to refresh file list
            let _ = state.app_handle.emit("file-imported", serde_json::json!({
                "file_id": file_id,
                "path": dest_path.to_string_lossy().to_string(),
            }));

            let resp = ImportResponse {
                success: true,
                file_id: Some(file_id),
                error: None,
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()))
        }
        Err(e) => {
            // Clean up the file if database insert failed
            let _ = std::fs::remove_file(&dest_path);
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()))
        }
    }
}

async fn import_image_from_url(
    State(state): State<HttpServerState>,
    Json(query): Json<ImportFromUrlQuery>,
) -> Result<Response<Body>, StatusCode> {
    log::info!("Downloading image from URL: {}", query.image_url);

    // Build request with optional referer
    let mut request = state.client.get(&query.image_url);

    if let Some(referer) = &query.referer {
        request = request.header("Referer", referer);
    }

    // Send request
    let response = match request.send().await {
        Ok(resp) => resp,
        Err(e) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Failed to download image: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
    };

    // Check status
    if !response.status().is_success() {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some(format!("Download failed with status: {}", response.status())),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()));
    }

    // Get content type from response headers (before consuming the response)
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim())
        .map(|s| s.to_string());

    // Get content
    let data = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Failed to read response: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
    };

    if data.is_empty() {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some("Empty response".to_string()),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()));
    }

    // Determine extension
    let ext = detect_extension_from_content_type(content_type.as_deref());
    let final_ext = if ext == "png" || ext.is_empty() {
        detect_extension_from_magic_bytes(&data)
    } else {
        ext
    };

    let db = state.db.lock().unwrap();

    // Get browser collection folder
    let folder = match db.get_browser_collection_folder() {
        Ok(Some(f)) => f,
        Ok(None) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some("Browser collection folder not found".to_string()),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
        Err(e) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            return Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()));
        }
    };

    // Generate unique filename
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let new_name = format!("browser_{}.{}", timestamp, final_ext);
    let dest_path = std::path::Path::new(&folder.path).join(&new_name);

    // Save file
    if let Err(e) = std::fs::write(&dest_path, &data) {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some(format!("Failed to write file: {}", e)),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap()));
    }

    // Get image dimensions
    let (width, height) = get_image_dimensions(&data).unwrap_or((0, 0));
    let metadata = std::fs::metadata(&dest_path).ok();

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let size = metadata.map(|m| m.len() as i64).unwrap_or(data.len() as i64);

    let file_record = FileRecord {
        id: 0,
        path: dest_path.to_string_lossy().to_string(),
        name: new_name.clone(),
        ext: final_ext.clone(),
        size,
        width: width as i32,
        height: height as i32,
        folder_id: Some(folder.id),
        created_at: now.clone(),
        modified_at: now.clone(),
        imported_at: now,
        rating: 0,
        description: String::new(),
        source_url: query.referer.unwrap_or_default(),
        dominant_color: String::new(),
        color_distribution: String::from("[]"),
    };

    match db.insert_file(&file_record) {
        Ok(file_id) => {
            log::info!("Imported browser image from URL: {} (id: {})", new_name, file_id);

            // Emit event to frontend to refresh file list
            let _ = state.app_handle.emit("file-imported", serde_json::json!({
                "file_id": file_id,
                "path": dest_path.to_string_lossy().to_string(),
            }));

            let resp = ImportResponse {
                success: true,
                file_id: Some(file_id),
                error: None,
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()))
        }
        Err(e) => {
            // Clean up the file if database insert failed
            let _ = std::fs::remove_file(&dest_path);
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()))
        }
    }
}

pub async fn start_http_server(db_path: std::path::PathBuf, app_handle: AppHandle) {
    // Create a new database connection for HTTP server
    let database = Database::new(&db_path).expect("Failed to create database for HTTP server");

    // Create HTTP client for downloading images
    let client = Client::builder()
        .user_agent("Shiguang-Collector/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    let state = HttpServerState {
        db: Arc::new(Mutex::new(database)),
        client,
        app_handle,
    };

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/import", post(import_image))
        .route("/api/import-from-url", post(import_image_from_url))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 7845));
    log::info!("Starting HTTP server on http://{}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}
