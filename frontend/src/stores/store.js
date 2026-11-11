import { defineStore } from 'pinia';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/apiBaseUrl';

const hasBuiltinApi = () => 'kugouapi' in window;

// sidecar（kugoumusicapi）冷启动未就绪时的设备注册重试参数：
// 退避 1500ms、最多 20 次 ≈ 30s，覆盖冷启动（最慢约 25s）与酷狗官方接口偶发返回空数据
const DEVICE_INIT_BACKOFF_MS = 1500;
const DEVICE_INIT_MAX_ATTEMPTS = 20;

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
    state: () => ({
        UserInfo: null, // 用户信息
        Config: null, // 配置信息
        Device: null, // 设备信息
    }),
    actions: {
        fetchConfig(key) {
            if (!this.Config) return null;
            const configItem = this.Config.find(item => item.key === key);
            return configItem ? configItem.value : null;
        },
        async setData(data) {
            if (data.UserInfo) this.UserInfo = data.UserInfo;
            if (data.Config) this.Config = data.Config;
        },
        clearData() {
            this.UserInfo = null; // 清除用户信息
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
    persist: {
        enabled: true,
        strategies: [
            {
                key: 'MoeData',
                storage: localStorage,
                paths: ['UserInfo', 'Config', 'Device'],
            },
        ],
    },
});