/**
 * 本地设备生成与持久化 —— 对齐原版 Electron 的 deviceUtil：
 * 不依赖 register_dev（酷狗对注册接口存在风控/偶发拒绝，导致 dfid 拿不到 →
 * 设备不完整 → 酷狗判登录失效），改为在本地生成「稳定唯一」的设备指纹，
 * 并跨启动持久化复用：酷狗只要请求每次携带同一组设备标识（uuid/mid/mac…）
 * 就视作同一设备，token 随之持续有效。
 *
 * 算法来源 kugoumusicapi util/util.js（getGuid / randomString / calculateMid）。
 */
const DEVICE_KEY = 'moekoe:device';

// ---- 精简 MD5 实现（MIT, 常见 port）------------------------------------
const MD5 = (string) => {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) {
    const lX4 = (lX & 0x40000000) * 2;
    const lY4 = (lY & 0x40000000) * 2;
    return (lX & 0x3fffffff) + (lY & 0x3fffffff) + lX4 + lY4;
  }
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }
  function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
  function ConvertToWordArray(string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition)) >>> 0;
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function WordToHex(lValue) { let WordToHexValue = ''; for (let lCount = 0; lCount <= 3; lCount++) { const lByte = (lValue >>> (lCount * 8)) & 255; WordToHexValue += (`0${lByte.toString(16)}`).slice(-2); } return WordToHexValue; }
  const x = ConvertToWordArray(string);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let k = 0; k < x.length; k += 16) {
    const a0 = a, b0 = b, c0 = c, d0 = d;
    a = FF(a, b, c, d, x[k + 0], 7, -680876936); d = FF(d, a, b, c, x[k + 1], 12, -389564586); c = FF(c, d, a, b, x[k + 2], 17, 606105819); b = FF(b, c, d, a, x[k + 3], 22, -1044525330);
    a = FF(a, b, c, d, x[k + 4], 7, -176418897); d = FF(d, a, b, c, x[k + 5], 12, 1200080426); c = FF(c, d, a, b, x[k + 6], 17, -1473231341); b = FF(b, c, d, a, x[k + 7], 22, -45705983);
    a = FF(a, b, c, d, x[k + 8], 7, 1770035416); d = FF(d, a, b, c, x[k + 9], 12, -1958414417); c = FF(c, d, a, b, x[k + 10], 17, -42063); b = FF(b, c, d, a, x[k + 11], 22, -1990404162);
    a = FF(a, b, c, d, x[k + 12], 7, 1804603682); d = FF(d, a, b, c, x[k + 13], 12, -40341101); c = FF(c, d, a, b, x[k + 14], 17, -1502002290); b = FF(b, c, d, a, x[k + 15], 22, 1236535329);
    a = GG(a, b, c, d, x[k + 1], 5, -165796510); d = GG(d, a, b, c, x[k + 6], 9, -1069501632); c = GG(c, d, a, b, x[k + 11], 14, 643717713); b = GG(b, c, d, a, x[k + 0], 20, -373897302);
    a = GG(a, b, c, d, x[k + 5], 5, -701558691); d = GG(d, a, b, c, x[k + 10], 9, 38016083); c = GG(c, d, a, b, x[k + 15], 14, -660478335); b = GG(b, c, d, a, x[k + 4], 20, -405537848);
    a = GG(a, b, c, d, x[k + 9], 5, 568446438); d = GG(d, a, b, c, x[k + 14], 9, -1019803690); c = GG(c, d, a, b, x[k + 3], 14, -187363961); b = GG(b, c, d, a, x[k + 8], 20, 1163531501);
    a = GG(a, b, c, d, x[k + 13], 5, -1444681467); d = GG(d, a, b, c, x[k + 2], 9, -51403784); c = GG(c, d, a, b, x[k + 7], 14, 1735328473); b = GG(b, c, d, a, x[k + 12], 20, -1926607734);
    a = HH(a, b, c, d, x[k + 5], 4, -378558); d = HH(d, a, b, c, x[k + 8], 11, -2022574463); c = HH(c, d, a, b, x[k + 11], 16, 1839030562); b = HH(b, c, d, a, x[k + 14], 23, -35309556);
    a = HH(a, b, c, d, x[k + 1], 4, -1530992060); d = HH(d, a, b, c, x[k + 4], 11, 1272893353); c = HH(c, d, a, b, x[k + 7], 16, -155497632); b = HH(b, c, d, a, x[k + 10], 23, -1094730640);
    a = HH(a, b, c, d, x[k + 13], 4, 681279174); d = HH(d, a, b, c, x[k + 0], 11, -358537222); c = HH(c, d, a, b, x[k + 3], 16, -722521979); b = HH(b, c, d, a, x[k + 6], 23, 76029189);
    a = HH(a, b, c, d, x[k + 9], 4, -640364487); d = HH(d, a, b, c, x[k + 12], 11, -421815835); c = HH(c, d, a, b, x[k + 15], 16, 530742520); b = HH(b, c, d, a, x[k + 2], 23, -995338651);
    a = II(a, b, c, d, x[k + 0], 6, -198630844); d = II(d, a, b, c, x[k + 7], 10, 1126891415); c = II(c, d, a, b, x[k + 14], 15, -1416354905); b = II(b, c, d, a, x[k + 5], 21, -57434055);
    a = II(a, b, c, d, x[k + 12], 6, 1700485571); d = II(d, a, b, c, x[k + 3], 10, -1894986606); c = II(c, d, a, b, x[k + 10], 15, -1051523); b = II(b, c, d, a, x[k + 1], 21, -2054922799);
    a = II(a, b, c, d, x[k + 8], 6, 1873313359); d = II(d, a, b, c, x[k + 15], 10, -30611744); c = II(c, d, a, b, x[k + 6], 15, -1560198380); b = II(b, c, d, a, x[k + 13], 21, 1309151649);
    a = II(a, b, c, d, x[k + 4], 6, -145523070); d = II(d, a, b, c, x[k + 11], 10, -1120210379); c = II(c, d, a, b, x[k + 2], 15, 718787259); b = II(b, c, d, a, x[k + 9], 21, -343485551);
    a = AddUnsigned(a, a0); b = AddUnsigned(b, b0); c = AddUnsigned(c, c0); d = AddUnsigned(d, d0);
  }
  return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
};

// ---- 设备字段生成（与 kugoumusicapi util 对齐）----------------------------
const randomString = (len = 10) => {
  const ks = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < len; i += 1) out += ks[Math.floor(ks.length * Math.random())];
  return out;
};

const getGuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const e = () => ((65536 * (1 + Math.random())) | 0).toString(16).substring(1);
  return `${e()}${e()}-${e()}-${e()}-${e()}-${e()}${e()}${e()}`;
};

const calculateMid = (str) => {
  // MD5(hex) → 按位累加转十进制（与原版一致；JS 精度不足用大整数分段）
  const digest = MD5(str);
  const CHUNK = 14; // 每段最多 14 位 hex，保证累加不溢出 Number 安全整数
  const parts = [];
  for (let i = 0; i < digest.length; i += CHUNK) {
    parts.push(BigInt(`0x${digest.slice(i, i + CHUNK)}`));
  }
  // 按原版语义累加（各段相加；数值与原版一致：每位 hex * 16^(len-1-i) 之和 = 整体整数值）
  // 原版是整串按位幂求和，等价于把整个 hex 当大整数。分段 BigInt 直接拼求整值：
  const full = parts.reduce((acc, p) => acc * (1n << BigInt(CHUNK * 4)) + p, 0n);
  return full.toString();
};

const generateWebGLHash = () => {
  // 与原版 Node fallback 一致：随机 uint64（十六进制→十进制）
  // 酷狗仅作设备标识，稳定性优先（持久化保证每次一致）。
  const lo = Math.floor(Math.random() * 0xffffffff);
  const hi = Math.floor(Math.random() * 0xffffffff);
  return (BigInt(hi) * 0x100000000n + BigInt(lo)).toString(10);
};

const MAC = '02:00:00:00:00:00';

/**
 * 取（或创建并持久化）本地设备标识。跨启动复用同一设备 → 酷狗识别为同一
 * 设备、token 持续有效；杜绝“每次启动新设备 → 登录失效”。
 */
export const getOrCreateLocalDevice = () => {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.guid && d.mid) return d;
    }
    const guid = getGuid();
    const device = {
      guid,
      mid: calculateMid(guid),
      dev: randomString(10).toUpperCase(),
      mac: MAC,
      webgl: generateWebGLHash(),
      dfid: '',
    };
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
    return device;
  } catch {
    return { guid: getGuid(), mid: '0', dev: randomString(10), mac: MAC, webgl: '0', dfid: '' };
  }
};

export const DEVICE_STORAGE_KEY = DEVICE_KEY;