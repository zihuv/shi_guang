use crate::db::{Database, FileWithTags, Folder, Tag};
use crate::indexer;
use crate::path_utils::{join_path, normalize_path, path_has_prefix};
use crate::storage;
use crate::AppState;
use base64::Engine;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderTreeNode {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub children: Vec<FolderTreeNode>,
    #[serde(rename = "fileCount")]
    pub file_count: i32,
    #[serde(rename = "sortOrder")]
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BatchImportItem {
    FilePath {
        path: String,
    },
    Base64Image {
        #[serde(rename = "base64Data")]
        base64_data: String,
        ext: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportTaskItemResult {
    pub index: usize,
    pub status: String,
    pub source: String,
    pub error: Option<String>,
    pub file: Option<FileWithTags>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportTaskSnapshot {
    pub id: String,
    pub status: String,
    pub total: usize,
    pub processed: usize,
    #[serde(rename = "successCount")]
    pub success_count: usize,
    #[serde(rename = "failureCount")]
    pub failure_count: usize,
    pub results: Vec<ImportTaskItemResult>,
}

pub(crate) mod files;
pub(crate) mod folders;
pub(crate) mod imports;
pub(crate) mod indexing;
pub(crate) mod system;
pub(crate) mod tags;
pub(crate) mod trash;

#[derive(Debug, Serialize)]
pub struct PaginatedFiles {
    pub files: Vec<FileWithTags>,
    pub total: i64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FileFilter {
    pub query: Option<String>,
    pub folder_id: Option<i64>,
    pub file_types: Option<Vec<String>>,
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub size_min: Option<i64>,
    pub size_max: Option<i64>,
    pub tag_ids: Option<Vec<i64>>,
    pub min_rating: Option<i32>,
    pub favorites_only: Option<bool>,
    pub dominant_color: Option<String>,
}
