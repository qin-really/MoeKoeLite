import { defineStore } from 'pinia';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiBaseUrl';

const hasBuiltinApi = () => 'kugouapi' in window;

// sidecar（kugoumusicapi）冷启动未就绪时的设备注册重试参数：
// 退避 1500ms、最多 20 次 ≈ 30s，覆盖冷启动（最慢约 25s）与酷狗官方接口偶发返回空数据
const DEVICE_INIT_BACKOFF_MS = 1500;
const DEVICE_INIT_MAX_ATTEMPTS = 20;

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
            // 登录态是否已从持久化恢复完成（供路由守卫等待，避免冷启动竞态误跳登录页）
            restored: !!restored,
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
        // 冷启动兜底：若初始恢复未命中（WebView2 storage 尚未就绪），再次尝试读取。
        // 幂等：已恢复则无操作。
        ensureRestored() {
            if (this.UserInfo) return this.UserInfo;
            if (this.restored) return null;
            const restored = restoreUserInfo();
            if (restored) {
                this.UserInfo = restored;
                this.restored = true;
                return restored;
            }
            return null;
        },
        async initDevice(attempt = 1) {
            if (this.Device) return this.Device;
            try {
                const response = await registerDeviceApi.get('/register/dev');
                const raw = hasBuiltinApi()? response?.data: response?.data?.data;
                // 仅接受含非空 dfid 的设备对象才算注册成功：
                // `data: []`（酷狗官方接口受限/初始化竞态）不得误判成功；
                // 兼容 response:{data:{dfid}} 与 axios 两级结构
                const device = raw?.dfid ? raw : (raw?.data?.dfid ? raw.data : null);
                if (device) {
                    this.Device = device;
                    return device;
                }
            } catch (error) {
                console.warn(`[MoeAuth] register /register/dev 第 ${attempt} 次失败：`, error);
            }
            // 后端未就绪（sidecar 冷启动）或尚未拿到 dfid —— 退避后重试，覆盖启动竞态。
            // 注意：重试不附加 timestamp 绕过服务端 apicache(2min)，避免高频真打酷狗触发限流。
            if (attempt < DEVICE_INIT_MAX_ATTEMPTS) {
                setTimeout(() => this.initDevice(attempt + 1), DEVICE_INIT_BACKOFF_MS);
                return null; // 本次调用先行返回，等待下一轮重试
            }
            console.error(`[MoeAuth] 重试 ${DEVICE_INIT_MAX_ATTEMPTS} 次仍未注册到设备（dfid），放弃设备注册`);
            return null;
        }
    },
    getters: {
        isAuthenticated: (state) => !!state.UserInfo && !!state.UserInfo, // 是否已登录
    },
    });