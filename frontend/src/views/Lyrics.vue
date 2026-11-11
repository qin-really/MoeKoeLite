<template>
    <div class="lyrics-container" :class="{ 'locked': isLocked, 'hovering': isHovering && !isLocked, 'lrc-align-left': alignState === 'left' }"
        :style="[lyricsFontStyle, resizeCursor ? { cursor: resizeCursor } : null]">
        <div class="lyrics-panel">
        <!-- 控制栏（仅当鼠标悬浮于歌词文字上才显示与可交互） -->
        <div class="controls-overlay" ref="controlsOverlay">
            <div class="controls-wrapper" :class="{ 'locked-controls': isLocked }" v-if="!isLocked">
                <div class="color-controls">
                    <button class="color-button" title="未播放歌词颜色" @click="$refs.defaultColorInput.click()">
                        <div class="color-preview" :style="{ backgroundColor: defaultColor }"></div>
                    </button>
                    <button class="color-button" title="已播放歌词颜色" @click="$refs.highlightColorInput.click()">
                        <div class="color-preview" :style="{ backgroundColor: highlightColor }"></div>
                    </button>
                    <input ref="defaultColorInput" type="color" :value="defaultColor"
                        @mousedown.stop @focus="pickingColor = true" @blur="pickingColor = false"
                        @input="e => handleColorChange(e.target.value, 'default')" class="hidden-color-input">
                    <input ref="highlightColorInput" type="color" :value="highlightColor"
                        @mousedown.stop @focus="pickingColor = true" @blur="pickingColor = false"
                        @input="e => handleColorChange(e.target.value, 'highlight')" class="hidden-color-input">
                </div>
                <button @click="cycleAlign" :title="alignState === 'left' ? '歌词靠左' : '歌词居中'">
                    <i :class="alignState === 'left' ? 'fas fa-align-left' : 'fas fa-align-center'"></i>
                </button>
                <button @click="changeFontSize(-4)" class="font-control" title="减小字体">
                    <i class="fas fa-minus"></i><i class="fas fa-font"></i>
                </button>
                <button @click="sendAction('previous-song')" title="上一首"><i class="fas fa-step-backward"></i></button>
                <button @click="togglePlay" :title="isPlaying ? '暂停' : '播放'">
                    <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
                </button>
                <button @click="sendAction('next-song')" title="下一首"><i class="fas fa-step-forward"></i></button>
                <button @click="changeFontSize(4)" class="font-control" title="增大字体">
                    <i class="fas fa-font"></i><i class="fas fa-plus"></i>
                </button>

                <button @click="toggleLock" class="lock-button" :title="isLocked ? '解锁' : '锁定'">
                    <i :class="isLocked ? 'fas fa-lock' : 'fas fa-lock-open'"></i>
                </button>
                <button @click="sendAction('close-lyrics')" title="关闭歌词"><i class="fas fa-times"></i></button>
            </div>
            <button v-else @click="unlockFromButton" class="lock-button locked-float" title="解锁歌词">
                <i class="fas fa-lock"></i>
            </button>
        </div>
        <!-- 歌词内容：复用全屏歌词渲染组件（LyricsView）；字体与全屏歌词同源 -->
        <div class="lyrics-content-wrapper" :class="{ 'locked': isLocked }">
            <LyricsView
                class="lrc-host"
                :lines="lyricsData"
                :current-time="currentTime"
                display-mode="single"
                highlight-mode="char"
                :show-translated="true"
                :show-romanized="false"
                :font-size="fontSize"
                :font-family="desktopLyricsFont"
                :default-color="defaultColor"
                :highlight-color="highlightColor"
                :align="alignState"
            />
        </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import LyricsView from '@/components/player/LyricsView.vue'

let currentSongHash = ''

const isPlaying = ref(false)
const isLocked = ref(false)
const controlsOverlay = ref(null)

const currentTime = ref(0)
const lyricsData = ref([])

const isLinux = window?.electron?.platform === 'linux'
const setIgnoreMouseEvents = (ignore) => {
    if (isLinux) return
    window.electron.ipcRenderer.send('set-ignore-mouse-events', ignore)
}

const getSettings = () => {
    try { return JSON.parse(localStorage.getItem('settings') || '{}') } catch { return {} }
}

// —— 字体：与全屏歌词同调用（同一 localStorage['fullscreen-lyrics-settings'].fontSize / settings.desktopLyricsFont）——
const FULLSCREEN_LYRIC_KEY = 'fullscreen-lyrics-settings'
const fontSize = ref('24px')
const desktopLyricsFont = ref('')
const fontFamilyFallback = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif"
const escapeFontFamily = (f) => String(f).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const lyricsFontStyle = computed(() => {
    const fam = desktopLyricsFont.value ? `"${escapeFontFamily(desktopLyricsFont.value)}", ${fontFamilyFallback}` : fontFamilyFallback
    return { fontFamily: fam }
})
const loadLyricsFontFromSettings = () => {
    let fs = {}
    try { fs = JSON.parse(localStorage.getItem(FULLSCREEN_LYRIC_KEY) || '{}') || {} } catch { fs = {} }
    fontSize.value = fs.fontSize || '24px'
    desktopLyricsFont.value = getSettings()?.desktopLyricsFont || ''
}
const saveLyricsFontToSettings = () => {
    let fs = {}
    try { fs = JSON.parse(localStorage.getItem(FULLSCREEN_LYRIC_KEY) || '{}') || {} } catch { fs = {} }
    fs.fontSize = fontSize.value
    localStorage.setItem(FULLSCREEN_LYRIC_KEY, JSON.stringify(fs))
    updateWindowSizeByFont()
}
const changeFontSize = (delta) => {
    const cur = Number.parseFloat(fontSize.value) || 24
    fontSize.value = `${Math.max(12, Math.min(160, cur + delta))}px`
    saveLyricsFontToSettings()
}
const handleStorageChange = (event) => {
    if (event.key !== 'settings') return
    loadLyricsFontFromSettings()
    loadAlignFromSettings()
}
// —— 歌词对齐（与全屏歌词同调用 fullscreen-lyrics-settings.align；left↔center 循环切换）——
const alignState = ref('center')
const loadAlignFromSettings = () => {
    try {
        const fs = JSON.parse(localStorage.getItem(FULLSCREEN_LYRIC_KEY) || '{}') || {}
        alignState.value = fs.align === 'left' ? 'left' : 'center'
    } catch { alignState.value = 'center' }
}
const cycleAlign = () => {
    alignState.value = alignState.value === 'left' ? 'center' : 'left'
    try {
        const fs = JSON.parse(localStorage.getItem(FULLSCREEN_LYRIC_KEY) || '{}') || {}
        fs.align = alignState.value
        localStorage.setItem(FULLSCREEN_LYRIC_KEY, JSON.stringify(fs))
    } catch { /* 忽略 */ }
}

// —— 颜色（未播放 / 已播放）——
const defaultColor = ref(localStorage.getItem('lyrics-default-color') || '#e3e3e3')
const highlightColor = ref(localStorage.getItem('lyrics-highlight-color') || '#4A90E2')
const pickingColor = ref(false)
const handleColorChange = (color, type) => {
    if (type === 'default') { defaultColor.value = color; localStorage.setItem('lyrics-default-color', color) }
    else { highlightColor.value = color; localStorage.setItem('lyrics-highlight-color', color) }
}

// —— 显隐/播放 反馈 ——
const persistDesktopLyricsSetting = (value) => {
    const s = getSettings()
    s.desktopLyrics = value
    localStorage.setItem('settings', JSON.stringify(s))
    window.electron.ipcRenderer.send('save-settings', JSON.parse(JSON.stringify(s)))
}
const sendAction = (action) => {
    if (action === 'close-lyrics' || action === 'display-lyrics') {
        persistDesktopLyricsSetting(action === 'display-lyrics' ? 'on' : 'off')
    }
    window.electron.ipcRenderer.send('desktop-lyrics-action', action)
}
const togglePlay = () => { isPlaying.value = !isPlaying.value; sendAction('toggle-play') }

// —— 锁定（托盘菜单为主入口；窗内解锁钮与托盘双向同步）——
const toggleLock = () => { isLocked.value = !isLocked.value; applyLockState() }
const unlockFromButton = () => { if (isLocked.value) { isLocked.value = false; applyLockState() } }
function applyLockState() {
    localStorage.setItem('lyrics-lock', isLocked.value)
    setIgnoreMouseEvents(isLocked.value)
    window.electron.ipcRenderer.send('lyrics-lock-state', isLocked.value)
}
window.electron.ipcRenderer.on('lyrics-lock-state', (_e, locked) => {
    isLocked.value = !!locked
    setIgnoreMouseEvents(isLocked.value)
})

// —— 歌词数据 ——
window.electron.ipcRenderer.on('lyrics-data', (_event, data) => {
    isPlaying.value = !!data?.playing
    const lyr = data?.lyricsData
    if (Array.isArray(lyr)) {
        const hash = data?.currentSongHash || ''
        if (hash && hash !== currentSongHash) { currentSongHash = hash; currentTime.value = 0 }
        lyricsData.value = lyr
    }
    if (typeof data?.currentTime === 'number') currentTime.value = Math.round(data.currentTime * 1000)
})
let playTimer = null
const tick = () => { if (isPlaying.value) currentTime.value += 5 }
window.electron.ipcRenderer.on('playing-status', (_e, playing) => { isPlaying.value = !!playing })

// —— 穿透 / 悬浮指向：默认窗口穿透；仅当鼠标悬浮在歌词文字上才指向（非穿透）——
const isHovering = ref(false)
const POLL_MS = 60
let pointerTimer = null
const isPointOnLyrics = (point, bounds) => {
    if (!point || !bounds) return false
    let hit = false
    const hitAny = (els) => {
        for (const el of els) {
            const r = el.getBoundingClientRect()
            const left = bounds.x + r.left, right = bounds.x + r.right
            const top = bounds.y + r.top, bottom = bounds.y + r.bottom
            if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return true
        }
        return false
    }
    hit = hitAny(document.querySelectorAll('.lrc-view .line, .controls-wrapper, .lock-button'))
    return hit
}
const pollPointer = () => {
    if (isLocked.value) { setIgnoreMouseEvents(true); isHovering.value = false; return }
    window.electron.ipcRenderer.invoke('lyrics-window-pointer-state').then((state) => {
        if (!state) return
        const hit = isPointOnLyrics(state.cursor, state.bounds)
        const ignore = !hit
        setIgnoreMouseEvents(ignore)
        isHovering.value = hit
        if (hit) updateResizeCursor('')
    }).catch(() => {})
}

// —— 窗口拖动（仅从歌词文字区域开始）——
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const resizeCursor = ref('')
let dragStartScreen = { x: 0, y: 0 }
let hasDragMoved = false
const throttle = (func, delay) => {
    let lastTime = 0
    return (...args) => {
        const now = Date.now()
        if (now - lastTime >= delay) { lastTime = now; func(...args) }
    }
}
const sendWindowDrag = throttle((bounds) => {
    window.electron.ipcRenderer.send('window-drag', bounds)
}, 16)
const setLyricsWindowFixedSize = (fixed) => {
    window.electron.ipcRenderer.send('lyrics-window-fixed-size', {
        width: window.innerWidth, height: window.innerHeight, fixed,
    })
}
const updateResizeCursor = (cursor) => {
    resizeCursor.value = cursor
    document.documentElement.style.cursor = cursor
    document.body.style.cursor = cursor
}
const isMouseOnLyrics = (event) => {
    const line = event.target?.closest?.('.line')
    const ctrl = event.target?.closest?.('.controls-wrapper, .lock-button')
    return !!(line || ctrl)
}
const startDrag = (event) => {
    if (isLocked.value || event.button !== 0) return
    const target = event.target
    if (target?.closest?.('button, input, select, textarea, a')) return
    if (!isMouseOnLyrics(event)) return
    isDragging.value = true
    hasDragMoved = false
    dragStartScreen = { x: event.screenX, y: event.screenY }
    dragOffset.value = { x: event.clientX, y: event.clientY }
}
const onDrag = (event) => {
    if (!isDragging.value) return
    const deltaX = event.screenX - dragStartScreen.x
    const deltaY = event.screenY - dragStartScreen.y
    if (!hasDragMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
        hasDragMoved = true
        setLyricsWindowFixedSize(true)
    }
    if (hasDragMoved) {
        const x = Math.round(event.screenX - dragOffset.value.x)
        const y = Math.round(event.screenY - dragOffset.value.y)
        sendWindowDrag({ x, y, width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) })
    }
}
const endDrag = () => {
    if (isDragging.value && hasDragMoved) setLyricsWindowFixedSize(false)
    isDragging.value = false
    hasDragMoved = false
    updateResizeCursor('')
    persistPosition()
}

// —— 窗口尺寸随字号固定 ——
const updateWindowSizeByFont = () => {
    const px = Number.parseFloat(fontSize.value) || 24
    const h = Math.max(128, Math.round(px * 3.1 + 16))
    const w = Math.max(800, Math.round(window.outerWidth || 900))
    const x = window.screenX || 0
    const y = window.screenY || 0
    sendWindowDrag({ x, y, width: w, height: h })
}

// —— 位置持久化（localStorage['lyrics-pos']：重启后恢复上次位置）——
const POS_KEY = 'lyrics-pos'
const persistPosition = () => {
    try {
        localStorage.setItem(POS_KEY, JSON.stringify({ x: window.screenX || 0, y: window.screenY || 0 }))
    } catch (_) { /* 忽略 */ }
}
// 是否已有持久化位置（供 onMounted 决定是否走居中显示）
const hasSavedPosition = () => {
    try { return !!JSON.parse(localStorage.getItem(POS_KEY) || 'null') } catch { return false }
}
const restorePosition = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
            const w = Math.max(800, Math.round(window.outerWidth || 900))
            const h = Math.round(window.outerHeight || 128)
            // 显示窗口并按保存位置定位（不居中，避免覆盖持久位置）
            window.electron.ipcRenderer.send('desktop-lyrics-action', 'display-lyrics-nocenter')
            setTimeout(() => {
                sendWindowDrag({ x: Math.round(saved.x), y: Math.round(saved.y), width: w, height: h })
            }, 40)
        }
    } catch (_) { /* 忽略 */ }
}

// —— 居中定位（无保存位置时首次显示） ——
const getWorkArea = () => ({
    left: window.screen.availLeft || screenLeft || 0,
    top: window.screen.availTop || screenTop || 0,
    w: window.screen.availWidth || 0,
    h: window.screen.availHeight || 0,
})
// 首次无保存位置时居中（屏中央）
const centerLyrics = () => {
    const wa = getWorkArea()
    const w = window.outerWidth || 900
    const h = window.outerHeight || 128
    const x = Math.round(wa.left + (wa.w - Math.max(800, w)) / 2)
    const y = Math.round(wa.top + (wa.h - h) / 2)
    sendWindowDrag({ x, y, width: Math.max(800, w), height: h })
}

onMounted(() => {
    isLocked.value = localStorage.getItem('lyrics-lock') === 'true'
    loadLyricsFontFromSettings()
    loadAlignFromSettings()
    window.addEventListener('storage', handleStorageChange)
    document.addEventListener('mousedown', startDrag)
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', endDrag)
    // 初始：默认穿透，随后由轮询按歌词命中再指向
    setIgnoreMouseEvents(true)
    if (!playTimer) playTimer = setInterval(tick, 5)
    updateWindowSizeByFont()
    // 开启状态持久化 + 位置持久化：上次开启 → 自动显示；有保存位置则定位恢复（不居中）
    if (getSettings()?.desktopLyrics === 'on') {
        if (hasSavedPosition()) {
            restorePosition() // 有持久位置：显示并定位到保存位置
        } else {
            sendAction('display-lyrics') // 首次开启：显示后居中
            centerLyrics()
        }
    }
    pointerTimer = setInterval(pollPointer, POLL_MS)
})
onBeforeUnmount(() => {
    if (playTimer) clearInterval(playTimer)
    if (pointerTimer) clearInterval(pointerTimer)
    window.removeEventListener('storage', handleStorageChange)
    document.removeEventListener('mousedown', startDrag)
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', endDrag)
    updateResizeCursor('')
})
</script>

<style>
/* 歌词窗必须透明：全局主题 dark.scss 会给 body/:root 设不透明背景，这里内嵌覆盖强制透明 */
html, body, :root {
    background-color: transparent !important;
    background: transparent !important;
    color: inherit;
}
</style>
<style lang="scss" scoped>
.lyrics-container {
    user-select: none;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    cursor: inherit;
    position: fixed;
    top: 0; bottom: 0; left: 0; right: 0;
    width: 100vw; height: 100vh;
    box-sizing: border-box;
    overflow: hidden;
    padding: 4px 8px 8px;
    &.hovering { cursor: move; }
}
.lyrics-panel {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    border: 1px solid transparent;
    background-color: transparent;
}
.lyrics-container.hovering .lyrics-panel {
    border-color: rgba(255, 255, 255, 0.08);
}
/* 歌词靠左：内容（歌词）与按键盒整体靠左，左边保留约 50px 留空 */
.lyrics-container.lrc-align-left {
    .lyrics-panel {
        align-items: flex-start;
        padding-left: 50px;
    }
    .controls-overlay {
        align-self: flex-start;
        margin: 0;
    }
    .controls-wrapper {
        margin-right: auto;
    }
}
.lyrics-content-wrapper {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
}
.lrc-host {
    width: 100%;
    height: 100%;
}
.controls-overlay {
    align-self: center;
    opacity: 0;
    transform: scale(0.98);
    transition: opacity 0.25s ease, transform 0.25s ease;
    height: 42px;
    flex: 0 0 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 10;
    pointer-events: auto;
}
.lyrics-container.hovering .controls-overlay { opacity: 1; transform: scale(1); }
.controls-wrapper {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    background: rgba(24, 24, 24, 0.68);
    padding: 4px 8px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    button {
        background: transparent;
        border: none !important;
        color: #fff;
        cursor: pointer;
        width: 30px !important;
        height: 30px !important;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s ease;
        &:hover { background: rgba(255, 255, 255, 0.18); }
        &:active { transform: scale(0.95); }
    }
    i { font-size: 16px; }
}
.locked-float {
    width: 34px !important;
    height: 34px !important;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.95);
    background: rgba(24, 24, 24, 0.62);
    border: 1px solid rgba(255, 255, 255, 0.18) !important;
    display: flex;
    align-items: center;
    justify-content: center;
    i { font-size: 13px; }
}
.color-controls { display: flex; gap: 4px; align-items: center; }
.color-button { padding: 2px !important; width: 24px !important; height: 24px !important; }
.color-preview { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.3); }
.hidden-color-input { position: absolute; visibility: hidden; width: 0; height: 0; padding: 0; margin: 0; border: none; }
</style>