import './bridge'; // 必须在最前：模块顶层即注入 Tauri 桌面桥（供 store 等顶层 hasBuiltinApi 判断）
import { initSidecarReady } from './utils/sidecarReady';
initSidecarReady(); // 预监听后端就绪事件（勿错过：就绪可能早于页面脚本）
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router/router';
import { formatMilliseconds, getCover, applyColorTheme, setTheme } from '../src/utils/utils';
import ModalPlugin from './plugins/ModalPlugin';
import MessagePlugin from './plugins/MessagePlugin';
import i18n from './utils/i18n';
import '@/assets/themes/dark.scss';
import { registerSW } from 'virtual:pwa-register'

const app = createApp(App);
const pinia = createPinia();
pinia.use(piniaPersistedstate);
app.config.globalProperties.$getCover = getCover;
app.config.globalProperties.$formatMilliseconds = formatMilliseconds;
app.config.globalProperties.$applyColorTheme = applyColorTheme;
app.config.globalProperties.$setTheme = setTheme;
app.config.errorHandler = (err, vm, info) => {
  console.error(`全局捕获异常: ${info}`, err);
};
app.config.warnHandler = (msg, vm, trace) => {
  console.warn(`全局捕获警告: ${msg}`, trace);
};
window.addEventListener('unhandledrejection', event => {
  console.error('未处理的 Promise 拒绝:', event.reason);
  // window.$modal.alert('系统错误');
});

if (!window.electron && !import.meta.env.DEV) {
  registerSW({
    onNeedRefresh() {
      console.log('有新内容可用，请刷新页面')
    },
    onOfflineReady() {
      console.log('应用已准备好离线工作')
    }
  })
}

app.use(pinia);
app.use(router);
app.use(i18n);
app.use(ModalPlugin);
app.use(MessagePlugin);

app.mount('#app');