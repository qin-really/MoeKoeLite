# MoeKoe Music — Tauri 壳（可独立成项目）

> MoeKoe Music 酷狗第三方播放器的 **Tauri 桌面壳**。
> 本目录为独立 Tauri 工程：Rust 壳 + kugoumusicapi sidecar 运行时 + NSIS 打包配置。
> 它依赖**前端产物**（Vue/Vite 构建输出 `dist/`）与 **sidecar 运行时**（由脚本从 kugoumusicapi 装配），两部分到位即可编译、运行、打包。

## 一、它是什么

原 Electron 版本迁移为 Tauri 后的桌面壳。前端 Vue3 100% 复用（WebView2 加载同一套前端），本目录承担原本 Electron 主进程的工作：

- 窗口体系：主窗 / 桌面歌词窗（透明置顶、穿透）/ MV 窗
- 系统托盘 + 原生菜单（6 项：显示/隐藏、上/暂停/下、退出）
- 深链协议 `moekoe://`（组队 `team/join?code=`）
- kugoumusicapi **sidecar** 自动拉起/回收（`127.0.0.1:6520`），前端请求全部改走 HTTP
- 外部 API 服务语义保留（`http://127.0.0.1:6520` + `ws://…/moekoe`）
- 开机自启、外链打开、日志导出等

**关键架构（方案 A）**：Tauri(Rust) 只做壳；酷狗 API 由 Node 编写的 kugoumusicapi 以 sidecar 子进程提供（含 node.exe 运行时，不要求用户装 Node）。

## 二、目录结构

```
src-tauri/
├── Cargo.toml / build.rs         Rust 工程与 tauri-build
├── tauri.conf.json               窗口/托盘/深链/bundle(NSIS)/resources 配置
├── capabilities/default.json     前端权限（窗口/深链/opener/start-dragging）
├── icons/                        由 build/icons 生成的 Tauri 全套图标
├── src/
│   ├── main.rs / lib.rs          入口、插件装配、前端→壳事件总线
│   ├── commands.rs               invoke 命令 + 事件分发（对齐 Electron ipcMain 通道）
│   ├── windows.rs                主/歌词/MV 三窗口交互
│   ├── tray.rs                   托盘 + 原生菜单
│   ├── deeplink.rs               moekoe:// 注册与解析
│   ├── sidecar.rs                sidecar 生命周期（spawn/回收/存活检查）
├── vendor/kugoumusicapi/         kugoumusicapi 源码副本（随项目分发，sidecar 装配的唯一来源）
├── frontend/                     前端源码副本（Vue3/Vite，随项目分发，供构建 dist）
│   ├── src/ public/ index.html vite.config.js package.json electron/defaultSettings.json
├── sidecar/                      ⚠️ 构建产物（不入 git，由脚本重建）
│   ├── node.exe                  node 运行时（复制自系统）
│   ├── kugoumusicapi/            API 源码 + 依赖（npm install 真实布局）
├── scripts/
│   ├── build-sidecar.mjs         sidecar 运行时一键装配（源：vendor/kugoumusicapi）
│   ├── register-deeplink.ps1     Windows dev 模式深链注册
├── README.md                     （本文件）
```

## 三、前置要求

| 依赖 | 版本/说明 |
|------|-----------|
| Rust 工具链 | ≥ 1.77.2（msvc target；Windows 需 MSVC C++ Build Tools + Windows 10/11 SDK —— 本机为 VS 2026 自定义目录，cargo 经 vswhere 自动定位） |
| WebView2 Runtime | Windows 10/11 自带（156+） |
| Node.js / pnpm | Node ≥ 22（构建 sidecar 用）；pnpm（本项目及前端副本依赖管理） |
| 前端产物 | 本目录自带前端副本 `frontend/`，构建后其 `frontend/dist/` 即前端产物（需将 `tauri.conf.json > build.frontendDist` 指到该处） |

## 四、构建与运行

```bash
# 1) 装配 sidecar 运行时（node.exe + vendor/kugoumusicapi 源码 + npm 依赖）——一次性/发版前
node scripts/build-sidecar.mjs

# 2) 构建前端（本目录自带 frontend/ 副本；在独立项目内执行）
cd frontend && pnpm install && pnpm build
#    —— 产出 frontend/dist；然后按需将 tauri.conf.json 的 build.frontendDist 指向 "./frontend/dist"

# 3) 开发联调：frontend 内先起 vite（pnpm serve，端口 8080），再在本目录跑 Rust 调试侧

# 4) 发布（免安装版：exe + assets/ + sidecar/）
pnpm tauri build --no-bundle

# 5) 发布（NSIS 安装包）——Tauri 首次需从 github 下载 NSIS 工具，网络受限时可：
#    $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR="https://gh-proxy.com/"   （镜像）
#    或预置 %LOCALAPPDATA%\tauri\nsis-3.13\nsis-3.13.zip 走缓存
pnpm tauri build
```

产物位置：`target/release/moekoemusic.exe`（免安装版直接双击；`--no-bundle` 时 `assets/`、`sidecar/` 与 exe 同目录即完整可运行）。

**深链 dev 注册**（Windows，dev 模式协议需手写注册表）：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/register-deeplink.ps1
```

## 五、sidecar（kugoumusicapi）集成要点

- **为什么不打包成单文件 exe？** kugoumusicapi 用 `readdir + require` 动态加载 236 个模块，bun/pkg 均无法静态捆绑；故保留 **node.exe + 源码 + npm 依赖**作为资源分发（约 90MB），`std::process::Command` 拉起。
- **启动参数**：`app.js --port=6520 --host=127.0.0.1`，cwd = `kugoumusicapi/` 目录。
- **两个必须记牢的坑**（已在 `sidecar.rs` 处理，勿回退）：
  1. **入口用相对路径 `app.js`**：绝对 Windows 路径（含盘符）会触发 node `EISDIR: lstat 'D:'` 直接崩溃，sidecar 起不来（正是"打包后后端不跟随启动"的根因）。
  2. **注入环境变量 `platform=lite` 与 `KUGOU_API_PLATFORM=lite`**（对齐 Electron 的 dataSource=concept）。缺失时官方 server 会把 `KUGOU_API_PLATFORM` 注入成字符串 `'undefined'`，酷狗按未知平台返回受限数据（登录态在、但付费/高音质歌曲拿不到 URL）。
- 官方 server 需要账号信息时读取 `Authorization: token=…;userid=…` 头并合并为 cookie（CORS 已允许该头）。

## 六、功能状态（相对精简后 Electron 版）

| 功能 | 状态 |
|------|------|
| 主窗/歌词窗/MV 窗/托盘/深链(teamcode)/外部 API 6520 | ✅ 已实现 |
| 桌面歌词（透明/置顶/穿透/拖动） | ✅ 已实现（穿透用 `set_ignore_cursor_events`） |
| 开机自启 / 日志导出 / 外链 | ✅ 已实现 |
| 全局快捷键（ctrl+shift+s 等） | ❌ 按需求整体移除（Rust+前端 UI+默认配置都删了） |
| 自绘 300×480 托盘浮窗菜单 | ⏸ 暂缓（当前原生菜单） |
| 任务栏缩略图按钮 / 桌面快捷方式节日图标 / 托盘曲目标题 | ⏸ 暂缓（win 专属增强） |
| 通知 / 自动更新 / 扩展系统(Chrome) / 状态栏歌词 / macOS | ❌ 迁移前已随精简移除 |

## 七、相关文档

| 文档 | 内容 |
|------|------|
| 仓库根 `TAURI_MIGRATION.md` | 迁移决策（方案 A：壳 + sidecar） |
| 仓库根 `TAURI_MIGRATION_INFO.md` | IPC 通道全清单、Electron 功能细节、风险点 |
| 仓库根 `docs/tauri-runtime-context.md` | 当前实现状态、环境、后续步骤（会被持续更新） |

## 八、许可证

GPL-2.0-only（与原仓库一致）。第三方：WebView2（微软）、kugoumusicapi（开源）、Vue/Tauri 生态。