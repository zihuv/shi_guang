# 采集与数据

## 采集方式

素材可以通过四种方式进入拾光：

- 点击顶部 **导入** 按钮批量选择文件
- 直接从系统拖拽文件或文件夹到应用窗口
- 从剪贴板粘贴图片
- 通过浏览器扩展采集网页图片

## 默认素材目录

首次启动时，如果没有配置素材目录，应用会自动创建 `~/Pictures/shiguang` 作为默认目录。这也是未指定目标文件夹时的导入位置。

## 已有目录 vs 新导入文件

- **已有目录加入索引**：扫描目录下的文件存入数据库，文件保留在原位置，不额外复制。适合管理已有素材库
- **新文件导入**（通过导入按钮、拖拽、粘贴、浏览器扩展）：文件复制到当前选中的文件夹，未指定时进入默认目录。导入时会自动提取尺寸、颜色等元数据

不支持格式（如 AI、EPS、相机 RAW）在导入和扫描时会被自动跳过。

## 浏览器采集

安装浏览器扩展后，网页图片通过右键菜单或拖拽发送到拾光，落入素材库的 **"浏览器采集"** 文件夹。这个文件夹在第一次采集时自动创建。

## 数据存放

### 素材目录内

每个素材目录下有一个 `.shiguang/` 隐藏目录：

```
<素材目录>/
├── .shiguang/
│   ├── db/shiguang.db        # 数据库（索引信息、标签、设置等）
│   └── thumbs/                # 缩略图缓存
├── 浏览器采集/                # 浏览器扩展导入的文件（首次采集时自动创建）
└── <其他文件夹>/               # 用户自己创建的文件夹
```

### 应用数据目录

`library-state.json` 记录当前打开的素材库路径和最近打开过的库列表，存放在系统的应用数据目录中：

| 系统    | 路径                                                        |
| ------- | ----------------------------------------------------------- |
| macOS   | `~/Library/Application Support/shiguang/library-state.json` |
| Windows | `%APPDATA%/shiguang/library-state.json`                     |
| Linux   | `~/.config/shiguang/library-state.json`                     |

删除这个文件不会影响素材库中的文件，只是重置应用的库配置。迁移素材库时也无需额外处理。

### 导出文件

导出素材时，文件会复制到 `~/Documents/shiguang_exports/` 目录，同时生成对应的 JSON 元数据文件。

## 支持的文件格式

| 类别   | 格式                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 图片   | JPG/JPEG, PNG, GIF, WebP, AVIF, HEIC/HEIF, SVG, BMP, ICO, TIFF, PSD                                                    |
| 视频   | MP4, AVI, MOV, MKV, WMV, FLV, WebM, M4V, 3GP, 3G2, TS, SWF, RMVB, RM, VOB, OGV, MXF, MPG/MPEG, M2TS, F4V, DV, DCR, ASF |
| 音频   | MP3, WAV, FLAC, AAC, OGG, M4A, APE, AIFF, AMR, WMA                                                                     |
| 文档   | PDF, TXT, DOC/DOCX, XLS/XLSX, PPT/PPTX, RTF, ODT, ODS, ODP, CSV, HTML, MHT                                             |
| 压缩包 | ZIP, RAR                                                                                                               |

不支持：AI、EPS、RAW（及各类相机原始格式 3FR/ARW/CR2/CR3/CRW/DNG/ERF/MRW/NEF/NRW/ORF/PEF/RAF/RW2/SR2/SRW/X3F 等）。

## 删除

- **回收站模式**：删除的文件进入回收站，可以在回收站页面恢复。Cmd/Ctrl+Z 可以撤销最近一次删除操作（会话内有效）
- **永久删除**：直接从文件系统删除
