---
name: shi-guang-debug
description: 时光桌面应用的调试技能。用于功能完成后检查、排查 bug 或验证功能是否正常工作。触发场景：完成功能后想检查、遇到 bug 需要排查、功能似乎有异常需要调试。调试手段：Rust 后端日志查看、MCP 工具（IPC 监控、日志读取、WebView 交互）、数据库数据查看。图片调试：不直接读取图片像素，而是使用 understand_image MCP 工具理解图片内容。
---

# 时光调试技能

## 调试流程

### 1. 启动调试会话

```
当前任务: <描述需要调试的内容>
```

### 2. 读取日志

首先读取应用日志，了解当前状态：

- **前端控制台日志**: `read_logs({ source: "console", lines: 100 })`
- **系统日志**: `read_logs({ source: "system", lines: 50 })`

### 3. 监控 IPC 通信

监控前后端交互：

```typescript
// 启动监控
ipc_monitor({ action: "start" });

// 执行需要测试的操作（如添加标签、搜索文件等）

// 获取捕获的调用
ipc_get_captured({});

// 停止监控
ipc_monitor({ action: "stop" });
```

### 4. 数据库调试

通过 Tauri 命令查看数据库状态：

使用 `ipc_execute_command` 调用 Rust 端命令：

- `get_all_files` - 查看所有文件
- `get_all_tags` - 查看所有标签
- `get_index_paths` - 查看索引路径

或者直接查询 SQLite：

```bash
sqlite3 ~/.local/share/shi-guang/data.db ".tables"
sqlite3 ~/.local/share/shi-guang/data.db "SELECT * FROM files LIMIT 10;"
sqlite3 ~/.local/share/shi-guang/data.db "SELECT * FROM tags;"
```

### 5. 图片调试

**重要**: 不要直接读取图片数据。使用 MCP 工具理解图片：

```typescript
// 截图当前 UI 状态
webview_screenshot({ format: "png" });

// 使用 understand_image 分析图片内容
understand_image({
  image_source: "<图片路径或截图>",
  prompt: "<描述你想了解什么>",
});
```

例如：

- "这个图片显示的是什么内容？"
- "图片中的文件列表正确吗？"
- "缩略图渲染是否正确？"

### 6. WebView 调试

如需更深入的 WebView 调试：

```typescript
// 获取 DOM 结构
webview_dom_snapshot({ type: "structure" });

// 获取无障碍树
webview_dom_snapshot({ type: "accessibility" });

// 执行 JS 代码
webview_execute_js({ script: "(() => { return document.title; })()" });
```

## 调试命令速查

| 目的       | 命令                                           |
| ---------- | ---------------------------------------------- |
| 控制台日志 | `read_logs({ source: "console", lines: 100 })` |
| 系统日志   | `read_logs({ source: "system", lines: 50 })`   |
| IPC 监控   | `ipc_monitor({ action: "start" })`             |
| 截图       | `webview_screenshot({})`                       |
| 图片理解   | `understand_image({})`                         |
| DOM 结构   | `webview_dom_snapshot({ type: "structure" })`  |

## 数据库路径

```
~/.local/share/shi-guang/data.db
```

## 常见调试场景

### 场景 1: 文件索引不生效

1. 读取控制台日志，查看索引是否有错误
2. 调用 `get_index_paths` 确认索引路径
3. 查询数据库 `files` 表确认文件是否被索引

### 场景 2: 标签添加失败

1. 启动 IPC 监控
2. 尝试添加标签
3. 查看捕获的 IPC 调用和响应
4. 检查是否有错误信息

### 场景 3: UI 显示异常

1. 截图查看当前 UI 状态
2. 使用 `understand_image` 分析截图内容
3. 获取 DOM 结构对比

### 场景 4: 搜索结果不正确

1. 查看数据库中的文件数据
2. 测试搜索关键词
3. 对比返回结果与数据库内容
