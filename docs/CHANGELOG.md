# Changelog

本文档记录所有值得用户关注的变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

### Changed

- 本地自然语言搜索运行时升级到 `omni_search 0.2.5`，Windows 打包默认精简为仅启用 DirectML 加速链路，暂不再引入 CUDA / TensorRT 相关运行时能力。

### Deprecated

### Removed

### Fixed

- 视觉索引处理 `AVIF` 图片时改为直接走 Rust 侧 `omni_search 0.2.6` 解码链路，不再依赖前端浏览器转码，避免这一路径继续占用 WebView 解码和 `data:` URL 传输成本。
- release 打包流程改为在 Linux / macOS / Windows 构建阶段从源码静态编译 `dav1d` 并链接进应用内部，下载后的正式安装包不再额外依赖用户机器上的 `dav1d` 动态库。
- Windows 安装包现在会额外携带 `DirectML.dll`，避免打包后的应用无法命中内置 DirectML 运行时。
- 修复重建视觉索引时处理 `AVIF` 图片仍可能卡死的问题；当前保留前端解码，但会优先在独立 Worker 中完成限尺寸 `JPEG` 转码，并对浏览器解码阶段加超时保护，避免单张异常文件无限阻塞任务。
- 修复个别 `AVIF` 图片在 CLIP 重建索引时仍可能触发主线程兼容解码并卡死前端的问题；视觉索引现在禁止回退到 `Image` 主线程兼容路径，异常文件会直接跳过并继续后续任务。
- 修复 `AVIF` 图片在本地视觉索引里仍可能卡在后端 `embed_image_path(path)` 路径的问题；当前会在 Rust 侧先完成解码与限尺寸 `JPEG` 转码，再把字节流送入 embedding 运行时，避免特定 `AVIF` 文件把整条建索引流程拖死。
- 修复本地视觉搜索运行后状态面板仍显示“未初始化 / 未确定”的问题，当前会按后台实际生效的运行时配置展示 `GPU/DirectML` 等 Provider 信息。
- 优化重建视觉索引时的图片处理路径，复用已缓存的视觉内容哈希，避免首张大图在建索引前重复完整解码。
- 修复 Windows 上在 `Device=自动` / `gpu-directml` 下重建视觉索引仍可能把应用整体拖死的问题；当前保留 `auto -> gpu/directml` 语义，但在后台视觉索引里会按固定批次回收并重建 DirectML runtime，避免长时间持有同一个 DML session 后把宿主进程拖死。

### Security
