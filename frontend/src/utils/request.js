// src/services/request.js
import axios from 'axios';
import { MoeAuthStore } from '../stores/store';
import { getApiBaseUrl } from './apiBaseUrl';
import { handleRiskResponse } from './riskVerify';
import { isSidecarReady, waitSidecarReady } from './sidecarReady';

const injectAuthHeader = (config) => {
    const MoeAuth = MoeAuthStore();
    const token = MoeAuth.UserInfo?.token;
    const userid = MoeAuth.UserInfo?.userid;
    const t1 = MoeAuth.UserInfo?.t1;
    const dfid = MoeAuth.Device?.dfid;
    const mid = MoeAuth.Device?.mid;
    const guid = MoeAuth.Device?.guid;
    const serverDev = MoeAuth.Device?.serverDev || MoeAuth.Device?.dev;
    const mac = MoeAuth.Device?.mac;
    const webgl = MoeAuth.Device?.webgl;

    const authParts = [];
    if (token) authParts.push(`token=${(token)}`);
    if (userid) authParts.push(`userid=${(userid)}`);
    if (dfid) authParts.push(`dfid=${(dfid)}`);
    if (t1) authParts.push(`t1=${(t1)}`);
    if (guid) authParts.push(`KUGOU_API_GUID=${(guid)}`);
    if (mid) authParts.push(`KUGOU_API_MID=${(mid)}`);
    if (serverDev) authParts.push(`KUGOU_API_DEV=${(serverDev)}`);
    if (mac) authParts.push(`KUGOU_API_MAC=${(mac)}`);
    if (webgl) authParts.push(`KUGOU_API_WEBGL=${(webgl)}`);
    // 对齐原版（createRequest 注入 KUGOU_API_PLATFORM: process.env.platform）
    // 使用 lite 数据源，避免酷狗把缺失平台误判为 undefined 返回受限数据
    const platform = 'lite';
    if (platform) authParts.push(`KUGOU_API_PLATFORM=${platform}`);

    if (authParts.length > 0) {
        config.headers = {
            ...config.headers,
            Authorization: authParts.join(';')
        };
    }
    return config;
}

// 创建一个 axios 实例
const httpClient = axios.create({
    baseURL: getApiBaseUrl(),
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// 请求拦截器
httpClient.interceptors.request.use(
    injectAuthHeader,
    error => Promise.reject(error)
);

// 响应拦截器
httpClient.interceptors.response.use(
    async response => {
        if (response.config.__rawResponse) {
            return response;
        }

        const riskResult = await handleRiskResponse(response, (retryConfig) =>
            httpClient.request({ ...retryConfig, __rawResponse: true }),
            (url, params) => httpClient.get(url, { params, __skipRisk: true }),
        );
        if (riskResult.handled) {
            return riskResult.data;
        }

        return response.data;
    },
    async error => {
        if (error.config?.__rawResponse) {
            return Promise.reject(error);
        }

        if (error.response) {
            const riskResult = await handleRiskResponse(error.response, (retryConfig) =>
                httpClient.request({ ...retryConfig, __rawResponse: true }),
                (url, params) => httpClient.get(url, { params, __skipRisk: true }),
            );
            if (riskResult.handled) {
                return riskResult.data;
            }
        }

        if (error.response) {
            console.error(`http error status:${error.response.status}`,error.response.data);
            if (error.response?.data?.data) {
                console.error(error.response.data.data);
            // } else {
            //     $message.error('服务器错误,请稍后再试!');
            }
        } else if (error.request) {
            console.error('No response received:', error.request);
            $message.error('服务器未响应,请稍后再试!');
        } else {
            console.error('Error:', error.message);
            $message.error('请求错误,请稍后再试!');
        }
        return Promise.reject(error);
    }
);

// ---- 简易请求级缓存（用于后端未就绪时先用上次成功数据渲染，就绪后刷新覆盖）----
const CACHE_NS = 'moekoe:api-cache';
function apiCacheKey(pathWithQuery) {
    return `u:${btoa(unescape(encodeURIComponent(pathWithQuery))).replace(/=/g, '')}`;
}
function readApiCache(path) {
    try {
        const raw = localStorage.getItem(`${CACHE_NS}:${apiCacheKey(path)}`);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || !d.body || Date.now() - d.at > 7 * 24 * 3600 * 1000) return null;
        if (!hasRealData(d.body)) {
            localStorage.removeItem(`${CACHE_NS}:${apiCacheKey(path)}`); // 清理空数据坏缓存
            return null;
        }
        return d.body;
    } catch { return null; }
}
// 是否有“真实”业务数据（排除酷狗偶发返回的空数组/空对象，避免空响应污染缓存）
function hasRealData(body) {
    const d = body?.data;
    if (d == null) return false;
    if (Array.isArray(d)) return d.length > 0;
    if (typeof d === 'object') return Object.keys(d).length > 0;
    return d !== '' && d !== '-' && d !== undefined;
}
function writeApiCache(path, body) {
    try {
        if (!hasRealData(body)) return; // 空响应不入缓存
        const cur = readApiCache(path);
        if (cur && hasRealData(cur)) return; // 保留已有非空缓存（酷狗偶发空不覆盖好数据）
        localStorage.setItem(`${CACHE_NS}:${apiCacheKey(path)}`, JSON.stringify({ at: Date.now(), body }));
    } catch { /* 容量满等静默 */ }
}

const requestBuiltinApi = async (path, payload) => {
    // 启动早期后端(sidecar)可能尚未就绪：先等待就绪再发，避免首屏请求失败即空
    const wasReady = isSidecarReady();
    if (!wasReady) await waitSidecarReady();
    const result = await kugouapi.request(path, injectAuthHeader(payload));
    const resp = result.body || { data: undefined, error_code: 0, error_msg: 'body is undefined', status: 0 };
    if (resp && resp.status === 1 && resp.data != null && resp.data !== undefined && resp.data !== '') {
        writeApiCache(path, resp); // 成功响应入缓存（供下次启动后端未就绪时回落）
    }
    const riskResult = await handleRiskResponse(result,
        (retryConfig) => requestBuiltinApi({ ...retryConfig }),
        (path, params) => requestBuiltinApi(path, { params, __skipRisk: true })
    );
    if (riskResult.handled) return riskResult.data;
    return resp;
    // 注：若后端长时间未就绪导致 kugouapi.request 抛错（网络拒绝），由调用侧
    // onSuccess/缓存兜底；这里不吞错以保留原有语义。
}

const hasBuiltinApi = () => 'kugouapi' in window;

// 封装 GET 请求
export const get = async (url, params = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, { params, ...config }):
            await httpClient.get(url, { params, ...config });
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        // 后端未就绪/网络错误：回落到上次成功缓存渲染（若有），等 sidecar-ready 后再刷新
        if (hasBuiltinApi()) {
            const cached = readApiCache(url);
            if (cached) {
                if (onSuccess) onSuccess(cached);
                return cached;
            }
        }
        if (onError) onError(error);
        throw error;
    }
};

// 封装 POST 请求
export const post = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, { params: data, ...config }):
            await httpClient.post(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 PUT 请求
export const put = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, { params: data, ...config }):
            await httpClient.put(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 DELETE 请求
export const del = async (url, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, config):
            await httpClient.delete(url, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装 PATCH 请求
export const patch = async (url, data = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, { params: data, ...config }):
            await httpClient.patch(url, data, config);
        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 封装上传图片请求
export const uploadImage = async (url, file, additionalData = {}, config = {}, onSuccess = null, onError = null) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        // 如果有其他数据（如关联的商品信息等），也可以添加到 formData
        for (const key in additionalData) {
            if (Object.prototype.hasOwnProperty.call(additionalData, key)) {
                formData.append(key, additionalData[key]);
            }
        }

        // 需要确保 Content-Type 被设置为 multipart/form-data
        const response = hasBuiltinApi()?
            await requestBuiltinApi(url, { params: formData, ...config, headers: { ...config.headers, 'Content-Type': 'multipart/form-data' } }):
            await httpClient.post(url, formData, {
            ...config,
            headers: {
                ...config.headers,
                'Content-Type': 'multipart/form-data'
            }
        });

        if (onSuccess) onSuccess(response);
        return response;
    } catch (error) {
        if (onError) onError(error);
        throw error;
    }
};

// 导出 httpClient 以便在需要的时候直接使用 axios 实例
export default httpClient;
