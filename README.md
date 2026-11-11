# MoeKoe Lite（极速版）— Tauri

基于 [MoeKoe Music](https://github.com/MoeJue/MoeKoeMusic) 的 **Tauri 极速版**桌面壳：Rust/Tauri 承担原本 Electron 主进程的工作，酷狗 API 由 kugoumusicapi（sidecar 子进程）提供，启动更轻量。

## 特性

- 主窗 / **桌面歌词窗**（透明、置顶、穿透、锁定、拖动、贴边/靠左对齐）/ MV 窗
- 系统托盘：显示/隐藏、上一曲/**暂停**/下一曲、**解锁歌词**、退出
- 桌面歌词状态持久化：位置、字号、颜色（未播放/已播放）、对齐、显示/隐藏
- 深链协议 `moekoe://`（组队 team/join）
- 免安装版（`dist/`：exe + assets + sidecar 同目录即可运行）与 NSIS 安装包

## 构建

前置：Rust ≥ 1.77（msvc）、Node ≥ 22、pnpm；WebView2（Win10/11 自带）。

```bash
# 1) 装配 sidecar 运行时（node.exe + kugoumusicapi 源码 + 依赖）
node scripts/build-sidecar.mjs

# 2) 构建前端
cd frontend && pnpm install && pnpm build

# 3) 免安装版（exe 与 assets/、sidecar/ 同目录即完整可运行）
cargo build --release

# 4) NSIS 安装包
pnpm tauri build
```

产物：`target/release/moekoemusic.exe`；安装包在 `target/release/bundle/nsis/*.exe`。

## 目录

- `src/` — Rust 壳（窗口 w/桌面歌词、托盘、sidecar 生命周期、深链、命令）
- `frontend/` — Vue3 前端（含桌面歌词 `views/Lyrics.vue` 与共享歌词渲染 `components/player/LyricsView.vue`）
- `vendor/kugoumusicapi` / `sidecar/` — 酷狗 API 后端及其运行时（sidecar 装配产物，重建脚本 `scripts/build-sidecar.mjs`）
- `dist/` — 免安装发布目录（构建产物，见 `.gitignore`）

## 说明

- 桌面歌词复用全屏歌词渲染组件（`LyricsView`），字号/对齐与全屏歌词同源（`localStorage['fullscreen-lyrics-settings']`）
- 托盘为固定功能菜单：**暂停**、**解锁歌词**
- 本仓库为极速版独立工程（原版 Electron 源码参考 `MoeKoeMusic-main/`，不入库）

## License

GPL-2.0-only（与原 MoeKoe Music 一致）。