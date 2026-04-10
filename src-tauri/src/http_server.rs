use axum::{
    body::Body,
    extract::{Json, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{get, options, post},
    Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Emitter;

use crate::db::Database;
use crate::media;
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

fn import_response(response: ImportResponse) -> Response<Body> {
    let body = serde_json::to_string(&response).unwrap();
    with_cors(
        Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
}

fn ensure_browser_collection_folder(
    state: &HttpServerState,
) -> Result<crate::db::Folder, Response<Body>> {
    let db = state.db.lock().unwrap();
    db.ensure_browser_collection_folder().map_err(|e| {
        import_response(ImportResponse {
            success: false,
            file_id: None,
            error: Some(e.to_string()),
        })
    })
}

fn with_cors<B>(response: Response<B>) -> Response<B> {
    let (mut parts, body) = response.into_parts();
    parts
        .headers
        .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    parts.headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET, POST, OPTIONS".parse().unwrap(),
    );
    parts
        .headers
        .insert(header::ACCESS_CONTROL_ALLOW_HEADERS, "*".parse().unwrap());
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
        return Ok(with_cors(
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        ));
    }

    // Get content type from headers
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim());

    let final_ext = media::detect_extension_from_content(content_type, &data)
        .map(str::to_string)
        .or_else(|| {
            query
                .filename
                .as_deref()
                .and_then(|filename| filename.rsplit('.').next())
                .map(|ext| ext.to_ascii_lowercase())
        })
        .unwrap_or_else(|| "png".to_string());

    let folder = match ensure_browser_collection_folder(&state) {
        Ok(folder) => folder,
        Err(response) => return Ok(response),
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let result = {
        let db = state.db.lock().unwrap();
        crate::commands::imports::import_bytes_with_database(
            &db,
            crate::commands::imports::ImportRequest {
                bytes: data,
                folder_id: Some(folder.id),
                fallback_ext: Some(final_ext),
                target_path: None,
                generated_name_prefix: Some("browser".to_string()),
                created_at: now.clone(),
                modified_at: now,
                rating: 0,
                description: String::new(),
                source_url: String::new(),
            },
        )
    };

    match result {
        Ok(file) => {
            log::info!("Imported browser image: {} (id: {})", file.name, file.id);
            crate::commands::post_import::handle_import_success(
                &state.app_handle,
                &file,
                crate::commands::post_import::ImportSuccessOptions {
                    emit_file_imported_event: true,
                },
            );

            let resp = ImportResponse {
                success: true,
                file_id: Some(file.id),
                error: None,
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ))
        }
        Err(e) => {
            log::error!("Failed to import browser image: {}", e);
            // Emit event to frontend to show error
            let _ = state.app_handle.emit(
                "file-import-error",
                serde_json::json!({
                    "error": format!("Database error: {}", e),
                }),
            );
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ))
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
            return Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ));
        }
    };

    // Check status
    if !response.status().is_success() {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some(format!(
                "Download failed with status: {}",
                response.status()
            )),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        ));
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
            return Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ));
        }
    };

    if data.is_empty() {
        let resp = ImportResponse {
            success: false,
            file_id: None,
            error: Some("Empty response".to_string()),
        };
        let body = serde_json::to_string(&resp).unwrap();
        return Ok(with_cors(
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        ));
    }

    let final_ext = media::detect_extension_from_content(content_type.as_deref(), &data)
        .unwrap_or("png")
        .to_string();

    let folder = match ensure_browser_collection_folder(&state) {
        Ok(folder) => folder,
        Err(response) => return Ok(response),
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let source_url = query.referer.unwrap_or_default();
    let result = {
        let db = state.db.lock().unwrap();
        crate::commands::imports::import_bytes_with_database(
            &db,
            crate::commands::imports::ImportRequest {
                bytes: data,
                folder_id: Some(folder.id),
                fallback_ext: Some(final_ext),
                target_path: None,
                generated_name_prefix: Some("browser".to_string()),
                created_at: now.clone(),
                modified_at: now,
                rating: 0,
                description: String::new(),
                source_url,
            },
        )
    };

    match result {
        Ok(file) => {
            log::info!(
                "Imported browser image from URL: {} (id: {})",
                file.name,
                file.id
            );
            crate::commands::post_import::handle_import_success(
                &state.app_handle,
                &file,
                crate::commands::post_import::ImportSuccessOptions {
                    emit_file_imported_event: true,
                },
            );

            let resp = ImportResponse {
                success: true,
                file_id: Some(file.id),
                error: None,
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ))
        }
        Err(e) => {
            let resp = ImportResponse {
                success: false,
                file_id: None,
                error: Some(format!("Database error: {}", e)),
            };
            let body = serde_json::to_string(&resp).unwrap();
            Ok(with_cors(
                Response::builder()
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            ))
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
        // 处理 CORS 预检请求
        .route(
            "/api/import-from-url",
            options(import_image_from_url_options),
        )
        .route("/api/import", options(import_image_options))
        .route("/api/health", options(health_check_options))
        .with_state(state);

    // CORS 预检请求处理
    async fn import_image_from_url_options() -> Response<Body> {
        with_cors(Response::builder().body(Body::empty()).unwrap())
    }

    async fn import_image_options() -> Response<Body> {
        with_cors(Response::builder().body(Body::empty()).unwrap())
    }

    async fn health_check_options() -> Response<Body> {
        with_cors(Response::builder().body(Body::empty()).unwrap())
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], 7845));
    log::info!("Starting HTTP server on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
