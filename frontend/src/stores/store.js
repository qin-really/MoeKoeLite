import { defineStore } from 'pinia';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiBaseUrl';
import { getOrCreateLocalDevice } from '../utils/device';

const hasBuiltinApi = () => 'kugouapi' in window;

// 登录态持久化键（localStorage，跨重启可靠保留 —— 已实测 WebView2 持久）
const MOEDATA_KEY = 'MoeData';

// 仅启动时读取登录态（同步，供路由守卫判断）；绝不主动写盘。
// 说明：登录态只在「登录成功 setData / 退出 clearData」时显式写入，避免
// 应用内其它字段（Device/Config）的 mutation 触发整包序列化，把未登录态的
// null UserInfo 覆盖掉已持久化的登录信息（三个窗口共享 localStorage，任意
// 窗口写盘都会影响全部——此前正是 lyrics/mv 窗口把登录态覆盖为 null，导致
// 每次启动都要求重新扫码）。
function restoreUserInfo() {
    try {
        const raw = localStorage.getItem(MOEDATA_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        return d?.UserInfo || null;
    } catch {
        return null;
    }
}

// 后台补读：若首读未命中（WebView2 storage 冷启动晚就绪），定时重读。
// 命中后写入响应式 store 并派发全局 `moekoe:auth-restored` 事件（供登录页
// 自动折返）。由 action `ensureRestoredPoll` 触发，注意必须以 store 实例
// （this）操作，才能触发响应式更新与 Login 折返。
function scheduleRestorePoll(store, pollKey) {
    if (store.UserInfo) return;
    if (store[pollKey]) return; // 防重复启动
    store[pollKey] = true;
    let tries = 0;
    const iv = setInterval(() => {
        tries += 1;
        const u = restoreUserInfo();
        if (u) {
            store.UserInfo = u;
            clearInterval(iv);
            window?.dispatchEvent(new CustomEvent('moekoe:auth-restored', { detail: u }));
        } else if (tries >= 30) {
            // 约 9s 仍未读到 → 判定无持久登录态，结束补读
            clearInterval(iv);
        }
    }, 300);
}

const registerDeviceApi = hasBuiltinApi()?
{ get: async(path, payload = {}) => {
    const res = await window.kugouapi?.request(path, payload);
    if(res?.body) return res.body;
} }:
// 用于设备注册的独立 axios 实例（不带拦截器，避免循环依赖）
axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 10000,
});

export const MoeAuthStore = defineStore('MoeData', {
    state: () => {
        const restored = restoreUserInfo();
        return {
            UserInfo: restored, // 用户信息（启动即从 localStorage 恢复登录态）
            Config: null, // 配置信息
            Device: null, // 设备信息
            // 是否仍需补读登录态（首读未命中时 true，供登录页/App 启动补读）
            hydrating: !restored,
            // 首读是否已成功（供其它逻辑快速判断）
            restored: !!restored,
            // 补读是否已启动（防重复）
            _pollStarted: false,
        };
    },
    actions: {
        fetchConfig(key) {
            if (!this.Config) return null;
            const configItem = this.Config.find(item => item.key === key);
            return configItem ? configItem.value : null;
        },
        async setData(data) {
            if (data.UserInfo) {
                this.UserInfo = data.UserInfo;
                // 登录成功才显式持久化（全量写盘一次，覆盖旧登录态）
                try {
                    localStorage.setItem(MOEDATA_KEY, JSON.stringify({ UserInfo: this.UserInfo }));
                } catch (e) {
                    console.warn('[MoeAuth] 持久化登录态失败', e);
                }
            }
            if (data.Config) this.Config = data.Config;
        },
        clearData() {
            this.UserInfo = null; // 清除用户信息
            try {
                localStorage.setItem(MOEDATA_KEY, JSON.stringify({ UserInfo: null }));
            } catch (e) {
                console.warn('[MoeAuth] 清除登录态失败', e);
            }
        },
        // 冷启动补读（幂等）：若首读未命中（WebView2 storage 晚就绪），启动后台
        // 轮询补读；命中后写入响应式 store 并派发 moekoe:auth-restored 事件（由
        // 登录页自动折返）。调用方：登录页 onMounted / App 启动。
        ensureRestoredPoll() {
            scheduleRestorePoll(this, '_pollStarted');
        },
        async initDevice() {
            if (this.Device) return this.Device;
            // 1) 本地生成/读取稳定设备（同步、跨启动持久复用同一设备）。
            //    酷狗将请求中携带的设备标识（uuid/mid/mac…）识别为该设备，
            //    不依赖 register_dev（该接口存在风控/偶发返回空，缺失 dfid 时
            //    内置 API 仍可正常工作——与原版 Electron 行为一致）。
            const local = getOrCreateLocalDevice();
            this.Device = { ...local, serverDev: local.dev };

            // 2) 尝试用 register_dev 补充 dfid（失败静默，不影响设备就绪）
            try {
                const response = await registerDeviceApi.get('/register/dev');
                const raw = hasBuiltinApi() ? response?.data : response?.data?.data;
                const dfid = raw?.dfid || raw?.data?.dfid;
                if (dfid) this.Device.dfid = dfid;
            } catch (e) {
                console.warn('[MoeAuth] register/dev 补充 dfid 失败（忽略，本地设备已就绪）', e);
            }
            return this.Device;
        }
    },
    getters: {
        isAuthenticated: (state) => !!state.UserInfo && !!state.UserInfo, // 是否已登录
    },
    });