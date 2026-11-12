/**
 * 后端（kugoumusicapi sidecar 6520）就绪状态：
 * - 应用会从 Rust 侧收到 `moekoe:sidecar-ready` 事件；
 * - 事件可能在监听前已触发（后端就绪快于页面脚本），故提供主动探测兜底。
 * 供 request 层在启动早期等待后端就绪，避免首屏请求失败即空。
 */
import { listen } from '@tauri-apps/api/event';

const READY_EVENT = 'moekoe:sidecar-ready';
let ready = false;
let waiter = null;

const markReady = () => {
  if (ready) return;
  ready = true;
  if (waiter) { waiter(); waiter = null; }
};

export function initSidecarReady() {
  if (ready) return;
  listen(READY_EVENT, markReady).catch(() => { /* 非 Tauri 环境忽略 */ });
}

export const isSidecarReady = () => ready;

/** 探测 6520 是否可连。用带 CORS 头的轻量路径（根路径 `/` 无 ACAO 会导致跨源被拦） */
async function probe() {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 2500);
    const r = await fetch('http://127.0.0.1:6520/register/dev', { method: 'GET', signal: c.signal });
    clearTimeout(t);
    return r.ok || r.status >= 200;
  } catch { return false; }
}

/**
 * 等待后端就绪（事件 + 轮询探测）。最多约 timeoutMs；超时同样 resolve（放行，
 * 由调用侧按结果决定是否重试）。
 */
export async function waitSidecarReady(timeoutMs = 15000) {
  if (ready) return;
  initSidecarReady();
  if (await probe()) { markReady(); return; }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300));
    if (ready) return;
    if (await probe()) { markReady(); return; }
  }
}