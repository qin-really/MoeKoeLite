/**
 * Tauri 桌面桥 —— 兼容层注入
 *
 * 在 Tauri 环境注入与 Electron preload 相同形状的桥，使现有 20+ 处
 * `window.electron / window.electronAPI / window.kugouapi` 调用零改动。
 *
 * 映射关系：
 *   window.electron.ipcRenderer.send     →  Tauri event {channel, args}  → Rust bus 分发
 *   window.electron.ipcRenderer.invoke   →  Tauri command（直接 invoke）
 *   window.electron.ipcRenderer.on       →  Tauri event listen（定向窗口内）
 *   window.electronAPI.*                 →  Tauri command
 *   window.kugouapi.request              →  HTTP 请求 kugoumusicapi sidecar（6520）
 *
 * 仅在 `__TAURI_INTERNALS__` 存在（Tauri 运行时）时生效；Electron / 纯 Web 不注入。
 */
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { installDragger } from './dragger';

const isTauriRuntime =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** sidecar API 地址（与 Rust s/csidecar.rs、defaultSettings apiModeConfig 一致） */
export const SIDECAR_BASE_URL = 'http://127.0.0.1:6520';

/** 事件桥通道（Rust lib.rs: FS_RUST_BUS） */
const BUS_CHANNEL = 'bridge:front_to_rust';

/** 注入一次，幂等 */
let injected = false;
export function injectDesktopBridge() {
  if (injected || !isTauriRuntime) return;
  injected = true;
  installElectronLike();
  installKugouApi();
  installDragger();
  // eslint-disable-next-line no-console
  console.log('[bridge] Tauri 桌面桥已注入');
}

// 关键：必须在 import 图顶层立即注入（而非等待 main.js 顶层语句），
// 因为 store.js 等模块在模块求值时即读取 `'kugouapi' in window`（顶层 hasBuiltinApi 快照）。
injectDesktopBridge();

/* ---------------- window.electron / electronAPI ---------------- */

function installElectronLike() {
  const ipcRenderer = {
    send: (channel, ...args) => {
      void emit(BUS_CHANNEL, { channel, args });
    },
    invoke: (channel, ...args) => {
      // 少数通用命令走自定义 invoke；未知通道回退为 bus（Rust 无对应时静默）
      const mapped = invokeChannel(channel, args);
      if (mapped) return mapped;
      void emit(BUS_CHANNEL, { channel, args });
      return Promise.resolve(null);
    },
    on: (channel, listener) => {
      // 对齐 Electron ipcRenderer 语义：回调收到 (event, ...args)；
      // 把 Tauri 事件的 e（含 .payload）当作 event，payload 作为数据参数传第 2 位，
      // 否则所有 `(_event, data)` 双参消费者（如 Lyrics.vue 的 lyrics-data）data 恒为 undefined
      const wrapped = (e) => listener(e, e.payload);
      const unlisten = listen(channel, wrapped);
      const unsubscribe = () => void unlisten.then((u) => u());
      listener[Symbol.for('moekoe.unlisten')] = unsubscribe;
      // 返回可离线的 removeListener 函数（对齐 Electron on 语义）
      return unsubscribe;
    },
    once: (channel, listener) => {
      let removed = false;
      const wrapped = (e) => {
        if (removed) return;
        removed = true;
        listener(e, e.payload);
      };
      const unlisten = listen(channel, wrapped);
      const unsubscribe = () => {
        removed = true;
        void unlisten.then((u) => u());
      };
      wrapped[Symbol.for('moekoe.unlisten')] = unsubscribe;
      return unsubscribe;
    },
    removeListener: (_channel, listener) => {
      const w = listener && listener[Symbol.for('moekoe.unlisten')];
      if (typeof w === 'function') w();
    },
    removeAllListeners: (channel) => {
      // Tauri 无全部移除 API，用事件代理冲刷（兼容性兜底）
      void emit(`__moekoe_flush_all__${channel}`, {});
    },
  };

  const electronAPI = {
    openMvWindow: (url) => invoke('open_mv_window', { url }),
    openLogPath: () => invoke('open_log_path'),
    exportLog: () => invoke('export_log'),
    getApiModeUrl: () => invoke('get_api_service_endpoint'),
  };

  window.electron = {
    ipcRenderer,
    platform: 'win32', // 当前仅 Windows 目标
  };
  window.electronAPI = electronAPI;
}

/** bindings: Electron 通道 → Tauri command */
function invokeChannel(channel, args) {
  switch (channel) {
    case 'open-mv-window':
      return invoke('open_mv_window', { url: String(args[0] ?? '') });
    case 'open-log-path':
      return invoke('open_log_path');
    case 'export-log':
      return invoke('export_log');
    case 'get-api-service-endpoint':
      return invoke('get_api_service_endpoint');
    case 'lyrics-window-pointer-state':
      return invoke('lyrics_pointer_state');
    case 'lyrics-window-fixed-size': {
      const [o = {}] = args;
      return invoke('lyrics_fixed_size', {
        width: Number(o.width ?? 0),
        height: Number(o.height ?? 0),
        fixed: !!o.fixed,
      });
    }
    default:
      return null;
  }
}

function removeListeners(channel, listener) {
  window.electron?.ipcRenderer?.removeListener(channel, listener);
}

/* ---------------- window.kugouapi（sidecar HTTP） ---------------- */

let cachedDevice = null;

function installKugouApi() {
  window.kugouapi = {
    /** 与 Electron IPC 版返回形状一致：{ status, body, cookie, headers } */
    async request(path, payload = {}) {
      const params = payload?.params ?? {};
      const headers = { 'Content-Type': 'application/json' };
      if (payload?.headers?.Authorization) {
        headers.Authorization = payload.headers.Authorization;
      } else if (payload?.Authorization) {
        headers.Authorization = payload.Authorization;
      }

      // path 已含 query（如 /search/search?t=123）合并 params
      const url = new URL(path, SIDECAR_BASE_URL);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && typeof v !== 'object') {
          url.searchParams.set(k, String(v));
        }
      }
      // 设备已注入由 sidecar 端完成（服务端生成/读取），无需前端传 device

      let res;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers,
          credentials: 'omit',
        });
      } catch (err) {
        throw new Error(`[bridge] sidecar 不可达 ${SIDECAR_BASE_URL}: ${err.message}`);
      }

      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body, cookie: [], headers: {} };
    },

    getDevice: async () => {
      if (cachedDevice) return cachedDevice;
      // kugoumusicapi CLI 无独立 get-device 端点；内置 API 由服务端生成设备。
      cachedDevice = { guid: '', mid: '', dev: '', mac: '', webgl: '' };
      return cachedDevice;
    },

    generateNewDevice: async () => ({ success: false }),
  };
}

export const hasTauriBridge = () => isTauriRuntime;