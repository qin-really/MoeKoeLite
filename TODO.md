# TODO

## ⏳ 待办：sidecar 精简 —— pkg 单文件打包（方案 A）

> **状态**：挂起。前置条件 = 程序功能彻底修改完成后再做。
> **动机**：当前 sidecar 运行时过大 —— `node.exe`（91MB，机器上带的带符号版本）+ `node_modules/`（31MB，pnpm 结构展开）+ kugoumusicapi 源码，`dist` 发布体合计约 **155MB**。
> **2026-11-10**：已按方案 A 记录，等程序改完统一执行。

### 目标

把 sidecar 从「node.exe + node_modules + kugoumusicapi 源码」树，精简为**单个 exe**（node 运行时 + 生产依赖 + 应用代码全部打进），体积 120MB → **约 30MB**。

### 做法（上游官方设计，kugoumusicapi `package.json` 自带脚本）

```bash
cd sidecar/kugoumusicapi
npx pkg . -t node14-win-x64 -C GZip -o bin/app_win --no-bytecode
```

- pkg 的 `assets` 官方已配好：`node_modules/axios`、`express`、`pako`、`qrcode`、`safe-decode-uri-component`、`module`、`public`
- 用社区维护分支可兼容新版 node 基座：`@yao-pkg/pkg`
- 原项目 `vercel/pkg` 已停维护，需注意基座下载与杀软误报

### 需改动的文件

1. **[src/sidecar.rs](src/sidecar.rs)**（约 10 行）：
   - `Command::new(node.exe) + arg("app.js")` → 直接跑打包出的单个 exe（`dir.join("app_win.exe")` 之类）
   - 保留：`--port=6520 --host=127.0.0.1` 参数、`platform=lite` / `KUGOU_API_PLATFORM=lite` 环境变量、cwd、`CREATE_NO_WINDOW`
   - `ensure_running` 的存在性检查改指向新 exe
2. **[scripts/build-sidecar.mjs](scripts/build-sidecar.mjs)**：
   - 移除「复制 node.exe + npm install」两步
   - 改为：拷贝 vendor → 跑 pkg 打包 → 产出单 exe 到 sidecar 目录
3. **.gitignore**：`/sidecar/` 整目录忽略已生效，无需再动

### 验收标准（保证能跑）

- 单 exe 启动后 `127.0.0.1:6520` 可访问
- 酷狗接口实测（登录 / 搜索 / 播放 URL 获取 / 歌词）与当前 node 方式一致
- 全量走一遍 `pnpm tauri build` 出安装包，确认 resources（sidecar）随包分发、运行正常
- 用 UPX 再压新 exe 属可选项，不作为主方案

### 备选（若 pkg 跑不通）

方案 B：换官方 node-v22 LTS 的 `node.exe`（91MB → 约 40MB）+ `npm ci --omit=dev --install-links` 重装生产依赖（node_modules 31MB → 约 15MB），总体 120MB → 约 57MB，且 **Rust 侧零改动**。