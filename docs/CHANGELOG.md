# Changelog

本文档记录所有值得用户关注的变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 Electron 桌面运行时，素材库、导入、扫描、缩略图、文件夹、标签、回收站、浏览器采集和 AI 元数据分析可在 TypeScript 后端中运行。
- 新增 Electron 版本本地 `chinese_clip` 自然语言搜图链路，支持模型目录校验、CPU 推理、视觉索引建立、导入后自动向量化和文本搜图。
- 本地自然语言搜图新增 `fg_clip` 模型目录支持，可使用 FG-CLIP2 建立视觉索引和执行文本搜图。
- 本地自然语言搜图新增平台 GPU 加速选择，Windows 可使用 DirectML，Apple Silicon 可使用 CoreML；运行时保持懒加载，不影响应用启动速度。

### Changed

- 桌面端构建发布链路切换为 npm、electron-vite、Vite 8、Electron 和 electron-builder。
- 本地自然语言搜图状态页现在会显示模型校验、运行时加载状态，以及已索引、失败、待处理、过期图片数量。
- 发布脚本现在会把 `Unreleased` 变更整理为新版本 changelog，并写入 GitHub Release 说明。

### Fixed

- 隐藏 Windows 默认菜单栏，并修正桌面窗口与拖拽使用的应用图标资源。
- 修复 FG-CLIP2 处理小尺寸图片时 patch bucket 和位置向量长度不一致导致索引失败的问题。
- 修复 Electron 发布页下载链接与实际产物不一致的问题，并在发布流程中校验平台原生推理依赖。
- 修复 Linux `.deb` 打包缺少维护者邮箱导致发布流程失败的问题。

### Removed

- 移除前端运行时对 Tauri IPC、文件系统、日志和对话框插件的依赖。
- 移除 Tauri/Rust 后端和对应的构建发布流程。
