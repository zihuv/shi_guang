---
name: shi-guang-dev
description: 启动时光 (shi-guang) 桌面应用开发环境。使用场景：用户要求"启动项目"、"运行项目"、"开始开发"等。自动检测当前目录是否为 shi-guang 项目，然后运行 pnpm tauri dev。
---

# Shi Guang Dev

## 快速启动

在 shi-guang 项目根目录下，使用 `run_in_background` 参数后台运行：

```bash
pnpm tauri dev
```

这会同时启动：
1. Vite 前端开发服务器 (localhost:1420)
2. Tauri Rust 后端应用
