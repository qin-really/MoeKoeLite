#!/usr/bin/env node
/**
 * build-sidecar —— 从 node_modules 组装 kugoumusicapi sidecar 运行时
 *
 * 产物（不入 git，.gitignore 已排除）：
 *   src-tauri/sidecar/node.exe                  （node 运行时，从系统复制）
 *   src-tauri/sidecar/kugoumusicapi/            （源码 + npm 真实依赖）
 *
 * 用法：
 *   node src-tauri/scripts/build-sidecar.mjs
 *
 * 无需网络依赖 github（npm registry 即可）。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 基准目录：本脚本位于 src-tauri/scripts/，向上两级即 src-tauri 自身（目录自包含）
const tauriDir = dirname(dirname(fileURLToPath(import.meta.url)));
const sidecarDir = join(tauriDir, 'sidecar');
const kugouDir = join(sidecarDir, 'kugoumusicapi');

// 源统一取本项目 vendor 副本（目录自包含，不依赖任何外部 node_modules 布局）
const realKugou = join(tauriDir, 'vendor', 'kugoumusicapi');

function step(msg) {
  console.log(`[build-sidecar] ${msg}`);
}

function main() {
  if (!existsSync(realKugou)) {
    throw new Error(`未找到 vendor/kugoumusicapi: ${realKugou}`);
  }

  // 1) 复制源码（vendor 已是解引用后的真实文件）
  step('复制 kugoumusicapi 源码…');
  rmSync(kugouDir, { recursive: true, force: true });
  mkdirSync(kugouDir, { recursive: true });
  cpSync(realKugou, kugouDir, { recursive: true });
  rmSync(join(kugouDir, 'node_modules'), { recursive: true, force: true });

  // 2) npm 本地安装依赖（registry，避开 github）
  step('npm install 依赖…');
  if (!existsSync(join(sidecarDir, 'package.json'))) {
    cpSync(new URL('./sidecar-package.json', import.meta.url).pathname.slice(1), join(sidecarDir, 'package.json'));
  }
  execSync('npm install --install-links ./kugoumusicapi --no-audit --no-fund', {
    cwd: sidecarDir,
    stdio: 'inherit',
  });

  // 3) 复制 node.exe 运行时
  step('复制 node.exe…');
  const nodePath = process.env.NODE_BINARY || process.execPath;
  if (!existsSync(nodePath)) throw new Error(`node.exe 不存在: ${nodePath}`);
  cpSync(nodePath, join(sidecarDir, 'node.exe'));

  step('✓ sidecar 已组装完成');
}

main();