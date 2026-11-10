/**
 * 窗口拖拽增强（Tauri）
 *
 * 原 Electron 用 CSS `-webkit-app-region: drag` 声明拖拽区。
 * WebView2 不支持该 CSS，且 Tauri 的 `data-tauri-drag-region` 会把拖拽区内
 * 的非 interactive 元素（如带 @click 的 div）误拖。因此这里显式接管：
 *
 *   - 给容器加 `data-moekoe-drag`（纯前端标记，Tauri 无副作用）
 *   - capture 阶段捕获 mousedown，命中拖拽区空白（target 无 data-tauri-nodrag）时
 *     调用 `core:window:start-dragging`，与 Tauri 的拖拽不冲突。
 *
 * 仅在 Tauri 运行时注入。兼容层安装时调用。
 */
import { invoke } from '@tauri-apps/api/core';

let installed = false;

export function installDragger() {
  if (installed) return;
  installed = true;

  let dragStart = null;

  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) return;
      // 拖拽区命中：命中容器本身或空白（无 interactive / nodrag 拦阻）
      const zone = e.target.closest?.('[data-moekoe-drag]');
      if (!zone) return;
      if (isExcluded(e.target)) return;

      void invoke('plugin:window|start_dragging').catch(() => {});
    },
    true, // capture：先于 Tauri 内部 drag-region 判定，确保非 interactive 空白区由我们接管
  );

  dragStart = (e) => {
    const _ = e;
  };
  void dragStart;
}

/** 与 Tauri interactive 白名单一致的排除判断 + 自定义 no-drag 标记 */
function isExcluded(target) {
  if (!(target instanceof Element)) return true;
  if (target.closest?.('[data-tauri-nodrag]')) return true;
  if (target.closest?.('[data-moekoe-drag]') === target) {
    // 容器自身无子元素命中（如点击 padding 空白）
    return false;
  }
  const tag = target.tagName;
  return (
    tag === 'A' ||
    tag === 'BUTTON' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'OPTION' ||
    tag === 'DETAILS' ||
    tag === 'SUMMARY' ||
    (target.isContentEditable && true) ||
    /^I$/i.test(tag) || // FontAwesome 图标
    /^IMG$/i.test(tag)
  );
}