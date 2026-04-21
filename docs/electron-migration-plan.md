# Tauri 到 Electron 迁移方案

本文档用于规划当前项目从 Tauri/Rust 全量迁移到 Electron/TypeScript 的范围、功能清单、技术选型、实施步骤和 CI 发布改造。目标是先提供可执行迁移蓝图，不包含本轮代码实现。

## 迁移目标

本次迁移的目标是彻底移除 Tauri 和 Rust 依赖，用 TypeScript + npm + Electron 实现桌面端能力。前端 React UI 尽量不重做，只替换 IPC、文件访问、本地服务和后端业务实现。

核心原则如下：

| 原则 | 说明 |
| --- | --- |
| 不依赖 Rust | 删除 `src-tauri/`、Rust crate、Tauri CLI、Tauri plugins、Cargo 构建和 Rust GitHub Actions。 |
| 不考虑旧 Tauri 兼容 | 不迁移旧 Tauri app data 位置和 Rust 特有诊断功能；但当前应用业务数据结构应在 Electron 版本中完整实现。 |
| 前端 UI 少改 | 保留 React 组件、Zustand store、Tailwind UI，优先重写 `src/services/tauri/*` 这一层。 |
| 功能完整 | 除“本地 CLIP 自然语言搜图”可作为后续阶段外，现有素材管理、导入、扫描、标签、回收站、插件采集、AI 元数据等功能都应恢复。 |
| 优先第三方库 | 图片处理用 `sharp`，SQLite 用 `better-sqlite3`，HTTP 采集服务用 `fastify`，参数校验用 `zod`，任务调度用 `p-queue` 或 `worker_threads`。 |
| 安全默认 | Electron renderer 不启用 Node，使用 `contextIsolation` + preload 白名单 API，不把 `ipcRenderer`、Node FS 或任意命令通道直接暴露给前端。 |

## 当前项目迁移面

当前项目由 Vite + React + TypeScript 前端和 Tauri v2 Rust 后端组成。前端 IPC 调用主要集中在以下目录：

| 位置 | 当前作用 | 迁移策略 |
| --- | --- | --- |
| `src/services/tauri/core.ts` | 封装 `invoke` 和错误归一化 | 改成 `window.shiguang.invoke`，或迁到 `src/services/electron/core.ts` 后全局替换 import。 |
| `src/services/tauri/files.ts` | 文件查询、导入、AI、视觉索引命令 | 保持函数签名，命令名映射到 Electron IPC。 |
| `src/services/tauri/folders.ts` | 文件夹树、创建、删除、移动、扫描 | 保持函数签名，后端 TypeScript 重写。 |
| `src/services/tauri/indexing.ts` | 设置、索引路径、缩略图、重建索引 | 保持函数签名，替换存储和图片处理。 |
| `src/services/tauri/system.ts` | 复制、移动、打开文件、资源管理器定位、拖出文件 | 用 Electron `shell`、`clipboard`、`webContents.startDrag` 实现。 |
| `src/services/tauri/tags.ts` | 标签 CRUD、排序、移动 | TypeScript SQLite 实现。 |
| `src/services/tauri/trash.ts` | 应用内回收站 | TypeScript SQLite + FS 实现。 |
| `src/hooks/useTauriImportListeners.ts` | Tauri 文件拖入事件、导入事件、浏览器解码请求 | 改为 Electron DOM drop + preload event listener。 |
| `src/utils/index.ts` | `convertFileSrc`、Tauri FS、缩略图、预览读取 | 改为 Electron 自定义协议和 preload FS。 |
| `src/lib/logger.ts` | Tauri log plugin | 改成 `electron-log` 前端转发。 |
| `src/lib/externalDrag.ts` | Tauri 外部文件拖出 | 改成 Electron `webContents.startDrag`。 |

Rust 后端当前提供的核心能力集中在 `src-tauri/src/commands/*`、`src-tauri/src/db/*`、`src-tauri/src/storage.rs`、`src-tauri/src/indexer.rs`、`src-tauri/src/http_server.rs`、`src-tauri/src/openai.rs`、`src-tauri/src/ml/*`。迁移时需要把这些能力迁到 Electron main process 的 TypeScript 服务层。

## 推荐技术栈

| 类型 | 推荐 |
| --- | --- |
| 包管理器 | npm + `package-lock.json` |
| 桌面框架 | Electron |
| 前端构建 | 保留 Vite + React |
| Electron 构建 | `electron-vite` 或自维护 Vite main/preload 配置 |
| 打包发布 | `electron-builder` |
| SQLite | `better-sqlite3` |
| 图片处理 | `sharp` |
| 文件类型识别 | `file-type`，必要时保留项目内魔数识别兜底 |
| HTTP 本地服务 | `fastify` + `@fastify/cors` |
| 参数校验 | `zod` |
| 日志 | `electron-log` |
| 并发任务 | `p-queue`、`worker_threads` |
| 文件工具 | `fs-extra`、Node `fs/promises` |
| OpenAI-compatible 请求 | Node `fetch` 或 `undici` |
| 本地 CLIP 运行时 | 后续阶段使用 `onnxruntime-node`，模型格式和预处理参考本地 `D:\code\omni_search` |

### 为什么建议 npm

`pnpm` 本身可以用于 Electron，但这个项目会引入多个原生 Node 模块，例如 `sharp`、`better-sqlite3`，后续如果做本地 CLIP 还可能引入 `onnxruntime-node`。Electron 的原生模块需要按 Electron 自带 Node ABI rebuild，npm 的安装布局和 CI 行为更直接，减少 workspace symlink、postinstall、asar unpack 和 native rebuild 的不确定性。

`sharp` 官方文档也提示 Electron 打包时需要把 `sharp` 和 `@img` 从 ASAR 中解包。因此无论 npm 还是 pnpm，都要专门处理 native deps；本项目切 npm 后，CI、`electron-builder install-app-deps` 和 lockfile 的可预期性更好。

## 推荐目录结构

建议新增 Electron 专用目录，不把 main process 代码混入 `src/`：

```text
electron/
  main.ts
  preload.ts
  ipc/
    registry.ts
    validators.ts
  services/
    app-state.ts
    database.ts
    schema.ts
    migrations.ts
    settings-service.ts
    file-service.ts
    folder-service.ts
    tag-service.ts
    trash-service.ts
    import-service.ts
    indexing-service.ts
    media-service.ts
    thumbnail-service.ts
    http-collector-service.ts
    ai-metadata-service.ts
    visual-search-service.ts
    system-service.ts
    log-service.ts
  workers/
    import-worker.ts
    scan-worker.ts
    thumbnail-worker.ts
  types/
    ipc.ts
    db.ts
    file.ts
```

前端可以逐步改名：

| 当前 | 迁移后 |
| --- | --- |
| `src/services/tauri/*` | 短期保留目录名但内部改 Electron IPC，或改成 `src/services/desktop/*`。 |
| `useTauriImportListeners` | 改名 `useDesktopImportListeners` 或 `useElectronImportListeners`。 |
| `TauriAiEndpointTarget` 类型别名 | 改成 `AiEndpointTarget`。 |

如果为了降低首轮改动风险，可以先不改目录名，只替换实现，等迁移稳定后再统一重命名。

## Electron 安全模型

主窗口建议配置如下：

| 配置 | 值 |
| --- | --- |
| `nodeIntegration` | `false` |
| `contextIsolation` | `true` |
| `sandbox` | `true`，如某些 preload 能力受限再评估 |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| `preload` | 只暴露白名单 API |
| `Content-Security-Policy` | 生产环境启用，资源尽量 `self` + 自定义协议 |

preload 不应暴露原始 `ipcRenderer`。正确做法是每个 API 都做白名单封装：

```ts
contextBridge.exposeInMainWorld("shiguang", {
  invoke: (command: DesktopCommand, args?: unknown) => ipcRenderer.invoke(command, args),
  on: (channel: DesktopEventChannel, callback: (payload: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  dialog: {
    open: (options: OpenDialogOptions) => ipcRenderer.invoke("dialog.open", options),
  },
  fs: {
    exists: (path: string) => ipcRenderer.invoke("fs.exists", { path }),
    readFile: (path: string) => ipcRenderer.invoke("fs.readFile", { path }),
    readTextFile: (path: string) => ipcRenderer.invoke("fs.readTextFile", { path }),
  },
  file: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  asset: {
    toUrl: (path: string) => ipcRenderer.invoke("asset.toUrl", { path }),
  },
});
```

所有 IPC handler 都应验证参数，建议 `zod` schema 放在 `electron/ipc/validators.ts`。事件通道也要白名单，避免 renderer 监听或发送任意内部事件。

## 自定义文件协议

当前 Tauri 使用 `convertFileSrc` 和 asset protocol 显示本地图片、视频、PDF、缩略图。Electron 中不建议直接使用裸 `file://` 显示任意路径，应注册自定义协议，例如：

| 协议 | 用途 |
| --- | --- |
| `shiguang-file://asset/<token>` | 显示素材原文件。 |
| `shiguang-file://thumbnail/<token>` | 显示缩略图缓存。 |

协议服务必须限制读取范围：

| 范围 | 允许 |
| --- | --- |
| 已配置索引路径 | 允许读取素材文件。 |
| `.shiguang/thumbnails` | 允许读取缩略图。 |
| 应用资源目录 | 允许读取图标、静态资源。 |
| 任意绝对路径 | 默认拒绝。 |

`asset.toUrl(path)` 不应把真实路径直接拼到 URL 里，建议用内存 token 映射真实路径，或对路径做严格编码并在协议 handler 内校验路径前缀。

## 数据库迁移范围

当前 schema version 是 10，Electron 版本应保留这些表：

| 表 | 作用 |
| --- | --- |
| `folders` | 文件夹树、系统文件夹、排序、同步字段。 |
| `files` | 素材记录、路径、尺寸、评分、描述、来源、颜色、软删除、hash。 |
| `tags` | 标签树、颜色、排序。 |
| `file_tags` | 文件和标签关联。 |
| `settings` | 主题、视图、AI 配置、索引路径、快捷键、删除模式等。 |
| `index_paths` | 素材库根目录。 |
| `file_visual_embeddings` | 本地视觉索引数据，首期可以保留表和状态但不启用 CLIP 搜索。 |

建议实现：

| 当前 Rust 能力 | Electron 实现 |
| --- | --- |
| `Database::new` | `openDatabase(dbPath)`，初始化 schema、trigger、index。 |
| `rusqlite` repository | `better-sqlite3` repository 类或函数模块。 |
| trigger/index 创建 | 原 SQL 迁移到 TS 字符串。 |
| `PRAGMA user_version` migrations | 保留 Electron 版本自己的 migration runner。 |
| `current_timestamp` | JS 格式化 `YYYY-MM-DD HH:mm:ss`。 |
| `sync_id` | 使用时间戳 + pid + counter，或 `crypto.randomUUID()`。 |

因为不考虑 Tauri 旧兼容，可以不迁移以下逻辑：

| 旧逻辑 | 处理 |
| --- | --- |
| legacy app data DB 迁移 | 不移植。 |
| legacy index DB 迁移 | 不移植，除非用户明确要求导入旧数据。 |
| Rust `migrate_or_get_db_path` 的旧位置兼容 | 改成 Electron 新路径初始化。 |

## 存储路径设计

建议保持用户可理解的素材库目录结构：

```text
<indexPath>/
  .shiguang/
    db/
      shiguang.db
    thumbnails/
      <shard>/
        <hash>.webp
```

默认索引路径：

| 平台 | 默认 |
| --- | --- |
| Windows/macOS/Linux | `app.getPath("pictures")/shiguang` |

当前索引路径配置：

| 数据 | 建议位置 |
| --- | --- |
| 当前库路径文本 | `app.getPath("userData")/current-index-path.txt` 或 Electron 设置表。 |
| 数据库 | `<indexPath>/.shiguang/db/shiguang.db`。 |
| 缩略图 | `<indexPath>/.shiguang/thumbnails`。 |

首期可以继续使用 `current-index-path.txt`，因为和当前 Rust 逻辑接近，便于 debug。

## IPC 命令迁移清单

以下命令应全部在 Electron IPC 中实现，命令名可以保持不变，减少前端改动。

### 文件与查询

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `get_all_files` | 分页读取全部未删除文件 | 支持 `page`、`pageSize`、`sortBy`、`sortDirection`。 |
| `search_files` | 按文件名搜索 | `LIKE` 搜索，保留分页排序。 |
| `get_files_in_folder` | 读取指定文件夹下素材 | 支持根目录 `folderId = null`。 |
| `get_file` | 读取单个文件 | 返回 tags 和 `deletedAt`。 |
| `filter_files` | 组合筛选 | 文件名、文件类型、日期、大小、标签、评分、收藏、颜色、排序。 |
| `update_file_metadata` | 更新评分、描述、来源 URL | 写 `files` 表。 |
| `update_file_dimensions` | 前端预览后回写尺寸 | 写 width/height。 |
| `extract_color` | 提取或刷新颜色 | 用 `sharp` 解码像素，更新 dominant/color distribution。 |
| `export_file` | 导出原文件和 metadata JSON | 默认导出到 Documents/shiguang_exports。 |
| `update_file_name` | 重命名文件 | FS rename + DB path/name 更新。 |

### 导入

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `import_file` | 导入单个本地文件 | 复制到目标目录，识别真实扩展，写 DB，触发 post-import。 |
| `import_image_from_base64` | 从剪贴板/base64 导入 | base64 decode，生成 `paste_` 文件名。 |
| `start_import_task` | 批量导入任务 | 支持 `file_path` 和 `base64_image` item。 |
| `get_import_task` | 查询导入任务状态 | 返回 snapshot。 |
| `cancel_import_task` | 取消导入任务 | 已开始的单文件操作可完成，后续跳过。 |
| `retry_import_task` | 重试失败项 | 用原 task 保存的 items 重建任务。 |

### 索引与缩略图

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `get_setting` | 读取设置 | 未找到时抛出 `Setting not found`，前端依赖该行为。 |
| `set_setting` | 写设置 | `INSERT OR REPLACE`。 |
| `get_index_paths` | 读取索引根路径 | 当前主要使用第一个路径。 |
| `get_default_index_path` | 创建并返回默认路径 | `Pictures/shiguang`。 |
| `add_index_path` | 添加索引路径 | 创建目录、`.shiguang` 结构。 |
| `switch_index_path_and_restart` | 切换库并重启 | 写当前库路径，调用 `app.relaunch()` + `app.quit()`。 |
| `sync_index_path` | 扫描单个库 | 递归扫描文件和文件夹。 |
| `rebuild_library_index` | 重扫全部库 | 当前所有 index paths。 |
| `reindex_all` | 旧重建索引入口 | 可代理到 `rebuild_library_index`。 |
| `get_thumbnail_path` | 生成/读取缩略图路径 | 用 `sharp` 生成 WebP，返回真实路径供协议转换。 |
| `get_thumbnail_data_base64` | 返回缩略图 base64 | 可保留给兼容调用。 |
| `get_thumbnail_cache_path` | 返回缩略图缓存路径 | 用相同 hash 规则。 |
| `save_thumbnail_cache` | 保存前端生成的视频/特殊格式缩略图 | base64 decode 写 WebP。 |
| `remove_index_path` | 删除索引路径记录 | 不删除用户文件。 |

### 文件夹

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `get_folder_tree` | 文件夹树和文件数 | 批量 count，按 sortOrder 排序。 |
| `init_default_folder` | 获取默认根文件夹 | 保持当前前端行为。 |
| `create_folder` | 创建文件夹 | FS mkdir + DB insert。 |
| `delete_folder` | 删除非系统文件夹 | 清文件 folder_id、删除 DB 文件记录、删除目录和缩略图。 |
| `rename_folder` | 重命名文件夹 | FS rename，递归更新子文件夹和文件 path。 |
| `move_folder` | 移动文件夹 | 跨盘 fallback copy + remove，递归更新 DB。 |
| `reorder_folders` | 排序 | 更新 sort_order。 |
| `scan_folders` | 扫描文件夹树 | 不处理文件，补齐 folders 表。 |
| `init_browser_collection_folder` | 初始化系统文件夹 | 名称 `浏览器采集`，sortOrder = -1。 |
| `get_browser_collection_folder` | 获取系统文件夹 | 供采集和 UI 使用。 |

### 标签

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `get_all_tags` | 标签树基础数据和 count | 只统计未删除文件。 |
| `create_tag` | 创建标签 | 支持 parentId。 |
| `update_tag` | 更新名称和颜色 | 保留唯一名称约束。 |
| `delete_tag` | 删除标签 | FK cascade 清关联。 |
| `add_tag_to_file` | 绑定标签 | `INSERT OR IGNORE`。 |
| `remove_tag_from_file` | 解绑标签 | 删除关联。 |
| `reorder_tags` | 同级排序 | 更新 sort_order 和 parent_id。 |
| `move_tag` | 移动标签 | 更新 parent_id 和 sort_order。 |

### 回收站

| 命令 | 功能 | 实现要求 |
| --- | --- | --- |
| `delete_file` | 按删除模式软删或永久删除 | `use_trash` 为 true 时写 `deleted_at`。 |
| `delete_files` | 批量删除 | 同上。 |
| `get_trash_files` | 获取回收站文件 | `deleted_at IS NOT NULL`。 |
| `restore_file` | 恢复文件 | 若原 folder 不存在，移动到默认 index root。 |
| `restore_files` | 批量恢复 | 同上。 |
| `permanent_delete_file` | 永久删除 | 删除缩略图、DB 记录、磁盘文件。 |
| `permanent_delete_files` | 批量永久删除 | 同上。 |
| `empty_trash` | 清空回收站 | 删除全部软删文件。 |
| `get_delete_mode` | 获取删除模式 | 默认 true。 |
| `set_delete_mode` | 设置删除模式 | 写 settings。 |
| `get_trash_count` | 回收站数量 | count。 |

### 系统能力

| 命令 | 功能 | Electron 实现 |
| --- | --- | --- |
| `copy_file` | 复制素材到文件夹 | FS copy + DB insert 新文件。 |
| `copy_files` | 批量复制 | 循环调用单文件复制。 |
| `move_file` | 移动素材 | FS rename，跨盘 fallback copy/remove。 |
| `move_files` | 批量移动 | 去重后循环。 |
| `copy_files_to_clipboard` | 复制文件到剪贴板 | Electron `clipboard` 对图片较容易；文件列表跨平台要单独适配，Windows 可考虑 `electron-clipboard-ex` 或平台脚本。 |
| `start_drag_files` | 从应用拖出文件 | `webContents.startDrag({ file, icon })`，多文件需验证 Electron 当前版本能力，不支持时降级为复制路径/打开所在目录。 |
| `open_file` | 默认应用打开文件 | `shell.openPath(file.path)`。 |
| `show_in_explorer` | 文件管理器中定位 | `shell.showItemInFolder(file.path)`。 |
| `show_folder_in_explorer` | 定位文件夹 | `shell.openPath(folder.path)` 或 `shell.showItemInFolder(folder.path)`。 |

## 媒体处理迁移

当前 Rust `media.rs` 和 `indexer.rs` 负责媒体探测、尺寸、颜色、hash、缩略图。Electron 版本建议分层：

| 模块 | 职责 |
| --- | --- |
| `media-service.ts` | 识别扩展、MIME、魔数、可扫描/可预览/可 AI 分析判断。 |
| `thumbnail-service.ts` | 缩略图 hash、路径、WebP 生成、缓存清理。 |
| `indexing-service.ts` | 扫描目录、增量更新 DB、处理丢失文件。 |
| `color-service.ts` | dominant color 和 7 色分布。 |

建议保留当前支持格式范围：

| 类型 | 扩展 |
| --- | --- |
| 图片 | jpg, jpeg, png, gif, svg, webp, bmp, ico, tiff, tif, avif, psd, ai, eps, raw, cr2, nef, arw, dng, heic, heif |
| 视频 | pdf, mp4, avi, mov, mkv, wmv, flv, webm, m4v, 3gp |

说明：当前 scan 支持一些设计/RAW/视频/PDF 文件，但后端不一定能解码全部格式。Electron 首期应至少完整支持扫描和展示占位；图片尺寸、颜色、缩略图、AI 转码、后续 CLIP 图像预处理都应以后端 `sharp` 为主，不依赖前端浏览器解码作为常规路径。`sharp`/libvips 覆盖 JPEG、PNG、WebP、AVIF、TIFF、GIF、SVG 等主流输入，AVIF 也应走后端处理。HEIC/HEIF、PSD、RAW 等格式按平台能力做实际验证；无法解码时记录明确原因并显示不可预览或占位，前端 canvas 解码只作为极少数格式的最后兜底，不能成为核心 pipeline 的依赖。

缩略图策略建议保留当前行为：

| 项 | 当前值 |
| --- | --- |
| 缓存版本 | `v3` 或数字版本 3。 |
| 生成阈值 | 长边大于 1440 且短边大于 320 时生成。 |
| 目标尺寸 | 短边 320。 |
| 输出格式 | lossless WebP 或高质量 WebP。 |
| 缓存路径 | `.shiguang/thumbnails/<hash-prefix>/<hash>.webp`。 |

颜色分布可先复用当前简单 K-means 逻辑：

| 步骤 | 实现 |
| --- | --- |
| 解码图片 | `sharp(path).resize(50, 50, { fit: "inside" }).raw().toBuffer()`。 |
| 主色 | 平均 RGB 或取聚类最高色。 |
| 色板 | K-means 7 类，合并相近颜色。 |
| 写库 | `dominant_color`、`dominant_r/g/b`、`color_distribution`。 |

视觉内容 hash 建议保持当前语义：解码为 RGB，hash 宽、高和像素内容，用于判断视觉索引是否过期。

## 导入和 post-import pipeline

当前导入逻辑不仅写文件，还会触发缩略图、颜色提取、AI 自动分析、视觉索引。Electron 版本建议保持同样 pipeline：

| 阶段 | 功能 |
| --- | --- |
| 读取来源 | 本地路径或 base64。 |
| 探测真实类型 | 优先魔数/`file-type`，其次文件扩展。 |
| 选择目标目录 | 选中文件夹，或默认 index path。 |
| 写文件 | 生成不冲突文件名，必要时 fallback 扩展。 |
| 写 DB | 插入或恢复同路径文件，保留旧 rating/description/sourceUrl。 |
| 生成 hash | 可视觉索引图片计算 visual content hash。 |
| post-import | 颜色、缩略图、AI 自动分析、视觉索引队列。 |
| 发事件 | `file-imported`、`file-updated`、`import-task-updated`。 |

批量导入任务要保留：

| 字段 | 说明 |
| --- | --- |
| `id` | `import-<unique>`。 |
| `status` | queued, running, completed, completed_with_errors, cancelled, failed。 |
| `total/processed` | 总数和已处理数。 |
| `successCount/failureCount` | 成功失败数。 |
| `results` | 每个 item 的 index、status、source、error、file。 |
| `cancelFlag` | 取消后停止后续 item。 |

长耗时操作不要阻塞主线程。建议导入任务的文件读取、图片处理放入 `worker_threads` 或受控并发队列，DB 写入保持串行或事务化。

## 浏览器扩展采集服务

当前浏览器扩展写死连接：

```text
http://127.0.0.1:7845
```

Electron 版本应保持端口和 API 不变，避免扩展大改。

| API | 功能 |
| --- | --- |
| `GET /api/health` | 返回 `{ "status": "ok" }`。 |
| `POST /api/import` | body 为图片 bytes，query 可带 filename。 |
| `POST /api/import-from-url` | JSON `{ image_url, referer }`，由桌面端下载后导入。 |
| `OPTIONS` | CORS 预检。 |

实现建议：

| 项 | 说明 |
| --- | --- |
| HTTP 框架 | `fastify`。 |
| CORS | 只允许必要方法和 headers，当前为扩展兼容可先允许 `*`。 |
| 下载 | Node `fetch`，带 `Referer` 和 user-agent。 |
| 导入目标 | 系统文件夹 `浏览器采集`。 |
| 成功事件 | 发送 `file-imported` 给 renderer。 |
| 失败事件 | 发送 `file-import-error` 给 renderer。 |

扩展代码本身可以基本不改，除非后续要增加端口发现或 Native Messaging。

## AI 元数据分析

当前 `openai.rs` 是 OpenAI-compatible Chat Completions 调用，不强绑定 OpenAI 官方 SDK。Electron 版本建议继续保留这个兼容层。

必须实现：

| 功能 | 说明 |
| --- | --- |
| `aiConfig` 读取 | settings key `aiConfig`。 |
| `test_ai_endpoint` | 发送简单文本请求，返回连通性结果。 |
| `analyze_file_metadata` | 图片转 JPEG data URL，调用多模态模型，解析 JSON。 |
| 批量分析任务 | 并发 1 到 5，最多重试 3 次，事件通知。 |
| 自动分析 | 导入后按 `aiAutoAnalyzeOnImport` 设置触发。 |
| 文件重命名 | 模型建议 filename，做非法字符清理和冲突处理。 |
| 标签创建 | 优先复用已有标签，否则创建新标签。 |
| 描述限制 | 200 字以内。 |

图片预处理用 `sharp`：

| 当前 Rust | Electron |
| --- | --- |
| resize 到长边 1280 | `sharp(path).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })` |
| 输出 JPEG quality 85 | `.jpeg({ quality: 85 })` |
| base64 data URL | `data:image/jpeg;base64,<...>` |

前端浏览器解码请求事件可以保留，但定位应从“常规能力”降级为“最后兜底”。主流程不应因为 Chromium 能解码某些格式就绕过 `sharp`，否则导入、缩略图、AI 分析和未来 CLIP 索引会出现多套不一致的图片预处理结果。

| 事件 | 方向 |
| --- | --- |
| `visual-index-browser-decode-request` | main -> renderer，请求前端用 canvas 转码。 |
| `complete_visual_index_browser_decode_request` | renderer -> main，返回 data URL 或错误。 |

即使保留这个机制，也只建议服务“用户明确打开某个特殊文件时的临时预览/诊断”。AI 元数据、颜色提取、缩略图和自然语言索引应统一走 Node 后端 `sharp`，保证打包应用、后台任务和无 UI 场景行为一致。

## 本地 CLIP 自然语言搜图

当前 Rust 版本使用 `omni_search` + ONNX/DirectML 管理本地视觉模型，提供：

| 当前功能 | 状态 |
| --- | --- |
| 模型目录校验 | `validate_visual_model_path`。 |
| 推荐模型路径 | `get_recommended_visual_model_path`。 |
| 视觉索引状态 | `get_visual_index_status`。 |
| 重建视觉索引 | `rebuild_visual_index`、`start_visual_index_task`。 |
| 文本 embedding 查询 | `filter_files` 内处理 `natural_language_query`。 |
| 图像 embedding 入库 | `file_visual_embeddings`。 |

用户已指出本地 CLIP 自然语言搜索可能无法本期完成。建议不要在迁移首期硬塞半成品，但需要把 Electron 架构预留好，避免后续再大改 IPC、DB 和后台任务。

| 项 | 本期方案 |
| --- | --- |
| UI | 保留设置入口，但显示“Electron 版本暂未启用本地自然语言搜图”。 |
| DB | 保留 `file_visual_embeddings` 表，避免 schema 后续再改。 |
| API | `validate_visual_model_path`、`get_visual_index_status`、`start_visual_index_task` 等先返回明确 feature flag 状态。 |
| 普通搜索 | `query`、标签、颜色、文件类型等筛选必须完整可用。 |
| 自动向量化 | 默认关闭并不执行。 |

推荐后续路线是 `onnxruntime-node`，不要依赖前端 WebGPU/WebAssembly，也不要依赖浏览器图片解码。原因是自然语言搜图属于后台索引能力，需要在应用最小化、批量扫描、打包后 native 环境里稳定运行。

### 可参考的 `omni_search` 实现

本地参考项目 `D:\code\omni_search` 是 Rust，但设计可以迁移到 TypeScript。当前它的可复用思路如下：

| 能力 | `omni_search` 做法 | Electron/TS 迁移建议 |
| --- | --- | --- |
| 模型目录 | 扁平目录，根目录有 `model_config.json` 和 ONNX/tokenizer/embedding 资产 | 保留该格式，避免重新设计模型包。 |
| 模型族 | `chinese_clip`、`fg_clip`、`open_clip` | 先支持 `chinese_clip` 或 `open_clip`，再支持 `fg_clip`。 |
| manifest | 描述 `schema_version`、`family`、`embedding_dim`、`normalize_output`、text/image ONNX、输出名、tokenizer、预处理配置 | TS 中定义 `zod` schema，启动时做严格校验。 |
| 标准 CLIP 图片预处理 | resize shortest edge、center crop、mean/std、输出 `[B,3,H,W]` | 用 `sharp` 解码/resize/crop，再生成 `Float32Array` NCHW。 |
| FGCLIP2 图片预处理 | 动态 patch tokens，`pixel_values`、`pixel_attention_mask`、`pos_embed` | 后续单独移植，复杂度明显高于标准 CLIP。 |
| tokenizer | Rust `tokenizers` 加载 tokenizer 文件并做 padding/truncation | TS 需验证 `@huggingface/tokenizers` 或可用 Node binding；不稳定时自实现 WordPiece/BPE 子集。 |
| ORT provider | CPU/DirectML/CoreML/CUDA/TensorRT 分层尝试 | Electron 首期 CPU-only 最稳；DirectML/CUDA 作为独立优化阶段。 |
| 会话策略 | 支持 text/image session 预加载、卸载和单活策略 | Electron 中放到 utility process 或 worker，避免占用 main process。 |

### 建议的 Electron 模块划分

```text
electron/services/clip/
  clip-service.ts
  model-manifest.ts
  tokenizer.ts
  image-preprocess.ts
  fgclip-preprocess.ts
  ort-session.ts
  embedding-store.ts
```

| 模块 | 职责 |
| --- | --- |
| `model-manifest.ts` | 读取并校验 `model_config.json`，解析模型族和输入输出名。 |
| `ort-session.ts` | 封装 `onnxruntime-node` session 创建、warmup、释放、provider 状态。 |
| `tokenizer.ts` | 文本 tokenize、padding、attention mask、token embedding gather。 |
| `image-preprocess.ts` | 标准 CLIP 图片预处理，使用 `sharp` 生成 NCHW `Float32Array`。 |
| `fgclip-preprocess.ts` | FGCLIP2 动态 patch、attention mask、position embedding 插值。 |
| `embedding-store.ts` | Float32 little-endian BLOB 入库、读取和 cosine similarity。 |
| `clip-service.ts` | IPC 层调用的模型加载、索引任务、文本查询、任务取消。 |

### `onnxruntime-node` 实现顺序

| 阶段 | 目标 | 说明 |
| --- | --- | --- |
| 1 | CPU-only `chinese_clip` 或 `open_clip` | 标准 CLIP 图片预处理固定 `224x224` 或 manifest 指定尺寸，最容易验证。 |
| 2 | 文本和图片 embedding 一致性测试 | 用同一批样例对比 `omni_search` 输出 cosine，相似度应接近 1。 |
| 3 | Electron 后台任务接入 | 模型运行放 worker/utility process，main 只调度任务和写 DB。 |
| 4 | 向量入库和查询排序 | `file_visual_embeddings.embedding` 存 Float32 little-endian BLOB，查询时普通筛选先缩小候选集。 |
| 5 | FGCLIP2 | 移植动态 patch token、`pos_embed` 插值和 `fgclipMaxPatches`。 |
| 6 | 加速 provider | Windows 优先 DirectML，CUDA/TensorRT 后置；macOS 评估 CoreML 支持情况。 |

### FGCLIP2 迁移要点

`FGCLIP2` 不是普通 resize+crop CLIP，不能用标准 CLIP 预处理替代。需要移植这些细节：

| 项 | 要求 |
| --- | --- |
| patch bucket | 支持 `128`、`256`、`576`、`784`、`1024`，默认建议 `576`。 |
| resize | 根据原图宽高、patch size、max patches 二分计算目标尺寸。 |
| pixel values | 输出 `[B,maxPatches,patchSize*patchSize*3]`，像素归一化到 `[-1,1]`。 |
| mask | 输出 `[B,maxPatches]`，有效 patch 为 1，padding 为 0。 |
| position embedding | 读取 f32 小端文件，对二维 grid 做双线性插值，输出 `[B,maxPatches,embeddingDim]`。 |
| batching | 不同 patch bucket 的图片要分组推理，不能混在一个 batch。 |

`omni_search` 的性能记录显示，CPU 上 `Chinese CLIP` 更轻，`FGCLIP2 max_patches=576` 是质量和成本更均衡的默认值。Electron 迁移时应先实现轻模型闭环，再做 FGCLIP2，否则容易把首期迁移风险集中到模型预处理和 native 打包上。

### 可选方案对比

| 方案 | 优点 | 风险 |
| --- | --- | --- |
| `onnxruntime-node` + manifest + 自研 preprocess/tokenizer | 接近当前 Rust 能力，能复用 `omni_search` 模型包思路，后台运行稳定 | 需要维护 tokenizer、图片预处理、provider 和 native 打包。 |
| `@huggingface/transformers` | 上手快，JS 生态成熟 | 中文 CLIP/FGCLIP2 支持、Electron 打包体积、离线模型路径和性能需要验证。 |
| 独立本地服务进程 | 与 Electron 解耦，崩溃隔离好 | 多进程分发、端口管理、升级和日志复杂。 |
| 云端 embedding API | 开发快 | 依赖网络和隐私策略，和“本地素材管理”定位冲突。 |

如果大库性能不足，第一步先做普通 SQL 筛选缩小候选集，再内存 cosine 排序；第二步再考虑 `sqlite-vec` 或外部向量索引。不要在首期引入复杂向量数据库，否则会扩大 native 依赖和 CI 打包面。

## 前端改造点

### IPC 调用层

建议保留业务函数签名，只替换底层：

| 当前 | 迁移后 |
| --- | --- |
| `invokeTauri<T>(command,args)` | `invokeDesktop<T>(command,args)` 或内部仍叫 `invokeTauri`。 |
| `@tauri-apps/api/event.listen` | `window.shiguang.on(channel, callback)`。 |
| `@tauri-apps/plugin-dialog.open` | `window.shiguang.dialog.open`。 |
| `@tauri-apps/plugin-fs.exists/readFile/readTextFile` | `window.shiguang.fs.*`。 |
| `convertFileSrc(path)` | `window.shiguang.asset.toUrl(path)`。 |

### 文件拖入

Tauri 当前通过 `tauri://drag-enter/drop/leave` 事件拿文件路径。Electron 应改为标准 DOM drag/drop：

| 行为 | 实现 |
| --- | --- |
| 拖入窗口 | `dragenter/dragover/dragleave/drop`。 |
| 取路径 | preload 暴露 `webUtils.getPathForFile(file)`。 |
| 去重 | 保留当前 `processedPaths` 逻辑。 |
| 目标文件夹 | 保留当前 `dragOverFolderId`。 |

### 文件拖出

当前从 UI 拖素材到外部系统依赖 Rust `drag` crate。Electron 可用 `webContents.startDrag`：

| 项 | 说明 |
| --- | --- |
| 单文件 | 官方支持明确。 |
| 多文件 | 需要验证当前 Electron 版本是否支持多文件；若不稳定，首期降级为复制文件路径或只拖第一个文件。 |
| 图标 | 使用现有 `src-tauri/icons/32x32.png` 迁到 `assets` 或 `buildResources`。 |

### 图片/视频/PDF/文本预览

| 当前 | 迁移后 |
| --- | --- |
| Tauri asset URL | Electron custom protocol URL。 |
| Tauri FS readFile | preload FS read。 |
| 前端 canvas 生成视频缩略图 | 可保留。 |
| 前端 browser decode worker | 仅作为特殊格式最后兜底，不参与缩略图、AI、CLIP 的常规后台 pipeline。 |

## Electron Main 运行时状态

建议用一个 `AppState` 对象替代 Rust `AppState`：

```ts
type AppState = {
  db: Database;
  dbPath: string;
  appDataDir: string;
  indexPath: string;
  importTasks: Map<string, ImportTaskEntry>;
  aiMetadataTasks: Map<string, AiMetadataTaskEntry>;
  visualIndexTasks: Map<string, VisualIndexTaskEntry>;
  browserDecodeRequests: Map<string, BrowserDecodeRequest>;
  mainWindow: BrowserWindow | null;
};
```

注意点：

| 项 | 要求 |
| --- | --- |
| DB 写入 | 单连接同步写入最简单，长任务中不要跨线程共享 better-sqlite3 connection。 |
| worker_threads | worker 内需要独立打开 DB，或只处理 CPU/图片任务，把 DB 写回 main。 |
| 事件发送 | 封装 `emitToMainWindow(channel,payload)`，窗口销毁时安全 no-op。 |
| 任务取消 | 使用 `AbortController` 或共享任务状态。 |

## npm scripts 建议

迁移后 `package.json` scripts 可调整为：

| script | 命令说明 |
| --- | --- |
| `dev` | 启动 Electron 开发模式，内部同时跑 Vite renderer。 |
| `renderer:dev` | 只启动 Vite，端口保持 `127.0.0.1:1420`。 |
| `electron:dev` | 启动 Electron main/preload watcher。 |
| `build` | type-check + renderer build + main/preload build。 |
| `dist` | `electron-builder` 打包当前平台。 |
| `dist:win` | Windows 安装包。 |
| `dist:mac` | macOS dmg/zip。 |
| `dist:linux` | AppImage/deb/rpm，按需要取舍。 |
| `lint` | Oxlint 覆盖 `src` 和 `electron`。 |
| `fmt` | oxfmt 覆盖 `src`、`electron`、配置文件。 |
| `docs:dev` | 保留网站开发。 |
| `docs:build` | 保留网站构建。 |
| `release` | 改成 npm 用法和 Electron 版本文件校验。 |

需要删除：

| script | 处理 |
| --- | --- |
| `tauri` | 删除。 |
| `tauri:dev:mem` | 删除，另建 Electron memory debug 文档。 |
| `tauri:dev:heap` | 删除。 |

## 依赖调整

删除：

```json
[
  "@tauri-apps/api",
  "@tauri-apps/plugin-dialog",
  "@tauri-apps/plugin-fs",
  "@tauri-apps/plugin-log",
  "@tauri-apps/plugin-shell",
  "@tauri-apps/cli"
]
```

新增生产依赖建议：

```json
[
  "better-sqlite3",
  "electron-log",
  "fastify",
  "@fastify/cors",
  "file-type",
  "fs-extra",
  "p-queue",
  "sharp",
  "zod"
]
```

后续启用本地 CLIP 时再新增：

```json
[
  "onnxruntime-node"
]
```

tokenizer 依赖需在实现阶段单独验证。优先尝试成熟 Node 绑定或 `@huggingface/tokenizers`；如果打包不稳定，再按模型族实现最小 tokenizer 子集。

新增开发依赖建议：

```json
[
  "electron",
  "electron-builder",
  "electron-vite",
  "@electron/rebuild",
  "@types/better-sqlite3",
  "@types/fs-extra"
]
```

如果不用 `electron-vite`，则需要自己配置 main/preload 的 Vite 或 esbuild 构建。

## electron-builder 配置重点

关键配置：

| 配置 | 建议 |
| --- | --- |
| `appId` | `com.zihuv.shiguang`。 |
| `productName` | `拾光` 或 `shiguang`，按现有发布习惯决定。 |
| `files` | `dist/**`、`dist-electron/**`、必要 package 文件。 |
| `asar` | true。 |
| `asarUnpack` | `**/node_modules/sharp/**/*`、`**/node_modules/@img/**/*`、`**/node_modules/better-sqlite3/**/*`。 |
| `directories.buildResources` | icons 和安装资源。 |
| `win.target` | `nsis`，可加 portable。 |
| `mac.target` | `dmg`、`zip`。 |
| `linux.target` | `AppImage`，可选 deb/rpm。 |
| `npmRebuild` | true。 |
| `nativeRebuilder` | `sequential`。 |

如果未来加入 `onnxruntime-node`，还要加入：

```json
{
  "asarUnpack": [
    "**/node_modules/onnxruntime-node/**/*"
  ]
}
```

## GitHub Actions 改造

### release workflow

当前 `.github/workflows/release.yml` 使用 pnpm、Rust toolchain、Tauri action、Linux WebKit/GTK 和 AVIF Rust 构建依赖。迁移后应删除这些步骤。

新的 build job 建议：

| 步骤 | 说明 |
| --- | --- |
| Checkout | `actions/checkout@v4`。 |
| Setup Node | `actions/setup-node@v4`，Node 22，`cache: npm`。 |
| Install | `npm ci`。 |
| Lint | `npm run lint`。 |
| Build | `npm run build`。 |
| Native deps | `npx electron-builder install-app-deps`，或依赖 builder 内置 rebuild。 |
| Package | `npx electron-builder --publish never`。 |
| Upload assets | 用 `softprops/action-gh-release` 上传 `dist-electron` 或 builder 输出。 |

平台矩阵：

| 平台 | runner | target |
| --- | --- | --- |
| Windows x64 | `windows-2022` | nsis/zip。 |
| macOS arm64 | `macos-15` | dmg/zip。 |
| Linux x64 | `ubuntu-22.04` | AppImage/deb。 |

可以保留现有流程结构：

| job | 是否保留 | 改造 |
| --- | --- | --- |
| `prepare` | 保留 | 版本校验文件改为 `package.json`、Electron builder 配置、扩展 manifest。 |
| `package_extension` | 保留 | 改成 npm 不影响，继续打包 `extensions/shiguang-collector`。 |
| `build` | 保留但重写 | 删除 Rust/Tauri，改 Electron builder。 |
| `publish` | 保留 | 继续发布 draft release。 |

### deploy website workflow

当前 `.github/workflows/deploy-website.yml` 使用 pnpm。迁移 npm 后改为：

| 当前 | 迁移后 |
| --- | --- |
| `pnpm/action-setup` | 删除。 |
| `cache: pnpm` | `cache: npm`。 |
| `pnpm install` | `npm ci`。 |
| `pnpm run docs:build` | `npm run docs:build`。 |

### release scripts

需要改：

| 文件 | 改造 |
| --- | --- |
| `scripts/prepare-release.cjs` | 版本校验移除 `src-tauri/tauri.conf.json`，加入 Electron 配置来源。 |
| `scripts/release.cjs` | `VERSION_FILES` 移除 Tauri 配置；帮助文案从 `pnpm release` 改 `npm run release -- <version>` 或保留 `npm run release <version>` 具体命令。 |

## 需要删除或替换的仓库内容

迁移完成后可以删除：

| 路径/内容 | 处理 |
| --- | --- |
| `src-tauri/` | 删除。 |
| `Cargo.toml`、`Cargo.lock` | 随 `src-tauri` 删除。 |
| `.cargo/` | 如只服务 Rust/Tauri，可删除。 |
| Tauri logs/docs | `docs/memory-analysis.md` 可保留为历史，也可新建 Electron 内存分析文档。 |
| `pnpm-lock.yaml` | 删除，新增 `package-lock.json`。 |
| `.pnpm-store` | 不提交，保持 gitignore。 |
| AGENTS 中 Tauri 启动说明 | 后续更新为 Electron 启动说明。 |
| package Tauri scripts/deps | 删除。 |

保留并迁移：

| 内容 | 处理 |
| --- | --- |
| `src-tauri/icons` | 图标资源迁移到 `buildResources` 或 `assets/icons`。 |
| `extensions/shiguang-collector` | 保留，HTTP 接口不变。 |
| `website/` | 保留，只改 npm workflow。 |
| `docs/CHANGELOG.md` | 保留。 |

## 实施计划

### 阶段 1：Electron 骨架

目标：

| 任务 | 验收 |
| --- | --- |
| 建 `electron/main.ts` 和 `electron/preload.ts` | `npm run dev` 能打开现有 React UI。 |
| 注册 IPC 白名单 | 一个测试命令可从前端调用。 |
| 注册自定义协议 | 能显示一个本地测试图片。 |
| 替换 Tauri core wrapper | 前端编译不再依赖 `@tauri-apps/api/core`。 |

### 阶段 2：数据库和基础查询

目标：

| 任务 | 验收 |
| --- | --- |
| 建 schema/migration | Electron 能创建新库 DB。 |
| 实现 settings/index_paths | 首次启动自动创建默认库。 |
| 实现 files/folders/tags 基础 repository | 文件夹树、标签列表、空库 UI 正常。 |
| 实现 filter/search/pagination | 前端列表查询可用。 |

### 阶段 3：扫描、导入和缩略图

目标：

| 任务 | 验收 |
| --- | --- |
| 实现目录扫描 | 指定文件夹下素材入库。 |
| 实现导入任务 | Header 进度条正常。 |
| 实现 sharp 缩略图 | 大图生成 WebP 缩略图，列表可显示。 |
| 实现颜色提取 | 颜色筛选可用。 |
| 实现前端 drop | 从资源管理器拖文件到 app 可导入。 |

### 阶段 4：业务完整性

目标：

| 任务 | 验收 |
| --- | --- |
| 文件夹创建/删除/移动/重命名 | UI 操作和磁盘状态一致。 |
| 标签 CRUD/排序/移动 | UI 操作和筛选一致。 |
| 回收站 | 删除、恢复、永久删除、清空正常。 |
| 系统打开/定位 | `open_file`、`show_in_explorer` 正常。 |
| 复制/移动素材 | DB 和磁盘路径一致。 |

### 阶段 5：浏览器插件和 AI

目标：

| 任务 | 验收 |
| --- | --- |
| 本地 HTTP 服务 | 扩展 `checkConnection` 成功。 |
| URL 采集 | 网页图片进入“浏览器采集”文件夹。 |
| AI endpoint 测试 | 设置页测试可用。 |
| 单图 AI 分析 | 能重命名、写描述、打标签。 |
| 批量 AI 分析 | 进度、取消、失败提示正常。 |

### 阶段 6：打包和 CI

目标：

| 任务 | 验收 |
| --- | --- |
| npm lockfile | `npm ci` 可复现安装。 |
| electron-builder | 三平台至少能产出安装包。 |
| release workflow | tag 触发能创建 release assets。 |
| docs workflow | GitHub Pages 构建成功。 |
| 删除 Tauri/Rust | `rg tauri` 只剩历史文档或无业务引用。 |

### 阶段 7：自然语言搜图后续

目标：

| 任务 | 验收 |
| --- | --- |
| 调研模型运行时 | 以 `onnxruntime-node` 为主线，transformers 只做对比验证。 |
| worker/utility process | 模型加载不阻塞 UI。 |
| embedding 入库 | 图片向量可重建。 |
| 查询排序 | 自然语言 query 返回相似图片。 |

## 测试与验收清单

最小验收：

| 类型 | 命令/操作 |
| --- | --- |
| 安装 | `npm ci`。 |
| 静态检查 | `npm run lint`。 |
| 构建 | `npm run build`。 |
| Electron 开发 | `npm run dev`。 |
| 打包 | `npm run dist`。 |

手工功能验收：

| 功能 | 验收点 |
| --- | --- |
| 首次启动 | 自动创建默认素材库和 DB。 |
| 导入本地图片 | 文件复制、DB 记录、列表刷新、缩略图显示。 |
| 拖入导入 | 从系统文件管理器拖入多文件。 |
| 粘贴/剪贴板导入 | base64 图片导入。 |
| 文件夹 | 创建、重命名、移动、删除。 |
| 标签 | 创建、绑定、解绑、层级移动、排序。 |
| 搜索筛选 | 名称、文件类型、标签、评分、日期、大小、颜色。 |
| 回收站 | 软删、恢复、永久删除、清空。 |
| 浏览器扩展 | health、右键采集、拖拽采集。 |
| AI 元数据 | 测试 endpoint、单图分析、批量分析、取消。 |
| 打包应用 | 安装后图片处理、SQLite、HTTP 服务均可用。 |

性能和稳定性验收：

| 项 | 目标 |
| --- | --- |
| 大目录扫描 | 不冻结 UI，进度或状态可观察。 |
| 大图缩略图 | 不造成 main process 长时间卡顿。 |
| 批量导入 | 可取消，失败可重试。 |
| 内存 | 浏览大量图片后内存可控，缩略图 URL 不无限增长。 |
| native deps | 打包后 `sharp` 和 `better-sqlite3` 正常加载。 |

## 风险与注意事项

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 原生模块打包失败 | `sharp`、`better-sqlite3` 需要 Electron ABI 和 ASAR unpack | 使用 `electron-builder install-app-deps`，配置 `asarUnpack`，CI 三平台实际打包验证。 |
| 文件协议安全 | 任意路径读取会放大风险 | 自定义协议必须限制 index paths 和 thumbnails。 |
| 多文件拖出 | Electron 对外拖文件能力和多文件支持需实测 | 首期保证单文件，批量降级或另做平台适配。 |
| HEIC/RAW/PSD 支持 | sharp/libvips 对部分格式依赖平台能力 | 扫描和占位先保证，解码失败显示不可预览或最后兜底，不能依赖前端解码作为主路径。 |
| 主线程阻塞 | 图片处理和目录扫描 CPU/IO 重 | worker_threads 或任务队列隔离。 |
| CLIP 能力缺口 | Rust `omni_search` 没有直接 TS 等价实现，`onnxruntime-node` 和 tokenizer 都有 native/打包风险 | 本期 feature flag 降级；后续先做 CPU-only 标准 CLIP，再移植 FGCLIP2。 |
| SQLite 并发 | better-sqlite3 是同步库 | main 内串行写入；worker 不共享连接。 |
| npm 跨平台 lock | npm 多平台 optional deps 对 sharp 仍需验证 | CI 每个平台 `npm ci` + package，不依赖单平台 node_modules。 |

## 参考资料

| 资料 | 用途 |
| --- | --- |
| [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | Electron 安全默认值、context isolation、不要暴露原始 IPC、避免裸 `file://`。 |
| [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) | preload + contextBridge 的推荐暴露方式。 |
| [Electron Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) | 原生 Node 模块需要按 Electron rebuild。 |
| [Electron Native File Drag & Drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) | `webContents.startDrag` 实现从应用拖文件到系统。 |
| [Electron webUtils](https://www.electronjs.org/docs/latest/api/web-utils) | `webUtils.getPathForFile` 获取拖入文件真实路径。 |
| [sharp installation](https://sharp.pixelplumbing.com/install/) | sharp 支持格式、Electron ASAR unpack、bundler external 配置。 |
| [electron-builder configuration](https://www.electron.build/configuration.html) | `nativeRebuilder`、`npmRebuild`、平台打包配置。 |
| 本地 `D:\code\omni_search` | `onnxruntime-node` 方案的 Rust 参考：manifest、标准 CLIP/FGCLIP2 预处理、ORT provider、性能默认值。 |
