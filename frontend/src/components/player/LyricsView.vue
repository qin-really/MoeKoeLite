<template>
    <!-- 与全屏歌词（PlayerControl #lyrics）共用渲染：逐字高亮 + 当前行放大 + 翻译/音译 -->
    <div class="lrc-view"
        :class="{ 'line-highlight-mode': highlightMode === 'line', 'align-left': align === 'left' }"
        :style="{ fontSize, fontFamily, '--lrc-default': defaultColor, '--primary-color': highlightColor }">
        <template v-if="lines.length > 0">
            <div v-if="displayMode === 'single'" class="lrc-single">
                <transition name="lrc-fade" appear mode="out-in">
                    <div class="line-group" v-if="currentLine" :key="currentIndex">
                        <div class="line" :class="[align, { 'line-highlight': true }]">
                            <span v-for="(charData, ci) in currentLine.characters" :key="ci" class="char"
                                :class="{ active: isCharActive(charData) }">{{ charData.char }}</span>
                        </div>
                        <div v-if="showTranslated && currentLine.translated" class="line translated"
                            :class="[align, { 'line-highlight': true }]">{{ currentLine.translated }}</div>
                        <div v-if="showRomanized && currentLine.romanized" class="line romanized"
                            :class="[align, { 'line-highlight': true }]">{{ currentLine.romanized }}</div>
                    </div>
                </transition>
            </div>
            <div v-else class="lrc-list" :style="{ transform: `translateY(${listScroll ? listScroll + 'px' : '50%'})` }">
                <div class="line-group" :class="{ 'current-line-group': currentIndex === index }"
                    v-for="(lineData, index) in lines" :key="index">
                    <div class="line" :class="[align, { 'line-highlight': currentIndex === index }]">
                        <span v-for="(charData, ci) in lineData.characters" :key="ci" class="char"
                            :class="{ active: currentIndex === index && isCharActive(charData) }">{{ charData.char }}</span>
                    </div>
                    <div v-if="showTranslated && lineData.translated" class="line translated"
                        :class="[align, { 'line-highlight': currentIndex === index }]">{{ lineData.translated }}</div>
                    <div v-if="showRomanized && lineData.romanized" class="line romanized"
                        :class="[align, { 'line-highlight': currentIndex === index }]">{{ lineData.romanized }}</div>
                </div>
            </div>
        </template>
        <div v-else class="lrc-nolyrics">MoeKoe Music - 听你想听</div>
    </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
    lines: { type: Array, default: () => [] },        // [{ characters:[{char,startTime,endTime}], translated?, romanized? }]
    currentTime: { type: Number, default: 0 },          // ms
    displayMode: { type: String, default: 'single' },   // single | list
    highlightMode: { type: String, default: 'char' },   // char | line
    showTranslated: { type: Boolean, default: true },
    showRomanized: { type: Boolean, default: false },
    fontSize: { type: String, default: '30px' },
    fontFamily: { type: String, default: '' },
    align: { type: String, default: 'center' }, // center | left（歌词行对齐，与全屏歌词一致）
    defaultColor: { type: String, default: '#e3e3e3' },   // 未唱字色（覆盖 .char 渐变灰底）
    highlightColor: { type: String, default: '#4A90E2' }, // 已唱/高亮字色（覆盖 --primary-color）
})

// 当前行：based on 行内字符时间轴
const currentIndex = computed(() => {
    const ms = props.currentTime
    let idx = 0
    for (let i = 0; i < props.lines.length; i++) {
        const chars = props.lines[i]?.characters || []
        if (!chars.length) continue
        const start = chars[0].startTime ?? 0
        const end = chars[chars.length - 1].endTime ?? start
        if (ms >= start && ms <= end) { idx = i; break }
        if (ms > end) idx = i
    }
    return idx
})
const currentLine = computed(() => props.lines[currentIndex.value] || null)

// 单行/列表滚动偏移：保持组件简洁（滚动偏移由父级/外部按需扩展）
const listScroll = computed(() => 0)

// 逐字高亮（与全屏歌词一致：字符到点即点亮，不做连续渐变，避免逐字动画卡顿）：
// 已播放（currentTime >= 该字 endTime）→ class active 全亮；否则保持未播放色
function isCharActive(c) {
    if (!c) return false
    return props.currentTime >= (c?.endTime ?? c?.startTime ?? 0)
}
</script>

<style scoped>
.lrc-view {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    line-height: 1.8;
    white-space: pre-wrap;
    position: relative;
    user-select: none;
}

.lrc-view .line-group {
    position: relative;
    z-index: 1;
}
.lrc-view .line {
    display: block;
    width: fit-content;
    margin: 0 auto;
    padding: 0 10px;
    transition: color 0.24s ease;
}
.lrc-view .line.left {
    margin-left: 0;
    margin-right: auto;
    text-align: left;
}
.lrc-view .line.translated,
.lrc-view .line.romanized {
    color: #e3e3e3b1;
    font-size: 0.7em;
    opacity: 0.9;
    margin-top: 4px;
}
.lrc-view .char {
    display: inline-block;
    color: transparent;
    background: linear-gradient(to right, var(--primary-color, #4a90e2) 50%, var(--lrc-default, #e3e3e3) 50%);
    background-size: 200% 100%;
    background-position: 100% 0;
    -webkit-background-clip: text;
    background-clip: text;
    /* 与全屏歌词相同的单次平滑过渡（到点点亮，非逐帧连续渐变） */
    transition: background-position 0.6s ease;
}
.lrc-view .char.active,
.lrc-view .current-line-group .char.active {
    background-position: 0% 0;
}
.lrc-view .line-highlight .char {
    background-position: 100% 0;
}
.lrc-view .line-highlight .char.active {
    background-position: 0% 0;
}
.lrc-view .line-highlight.translated,
.lrc-view .line-highlight.romanized,
.lrc-view .current-line-group .line-highlight.translated,
.lrc-view .current-line-group .line-highlight.romanized {
    color: var(--primary-color, #4a90e2);
    opacity: 1;
}
/* line 高亮模式：字色整体切换（对齐全屏歌词 line-highlight-mode） */
.lrc-view.line-highlight-mode .char {
    color: var(--lrc-default, #e3e3e3);
    background: none;
    transition: color 0.24s ease;
}
.lrc-view.line-highlight-mode .line-highlight .char,
.lrc-view.line-highlight-mode .current-line-group .char {
    color: var(--primary-color, #4a90e2);
}
/* 当前行放大（对齐全屏歌词 current-line-group） */
.lrc-view .current-line-group {
    font-size: 1.18em;
    filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.25));
}
.lrc-nolyrics {
    color: var(--lrc-default, #9aa3b5);
    opacity: 0.85;
}
/* 单行模式容器：固定占满歌词区并垂直居中 → 换行时容器高度/重心不变，字幕终点位置稳定 */
.lrc-single {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    position: relative;
}
/* 歌词靠左：内容行贴左（留空由外层 .lyrics-panel padding-left 提供） */
.lrc-view.align-left .lrc-single {
    align-items: flex-start;
}
.lrc-single .line-group {
    position: relative;
}
.lrc-single .line-group .line {
    text-align: center;
}
/* 换行动画：out-in（先出后入，避免新旧叠闪/容器重心漂移）；短过渡，轻量不卡 */
.lrc-fade-enter-active,
.lrc-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.lrc-fade-enter-from { opacity: 0; transform: translateY(10px); }
.lrc-fade-enter-to { opacity: 1; transform: translateY(0); }
.lrc-fade-leave-from { opacity: 1; transform: translateY(0); }
.lrc-fade-leave-to { opacity: 0; transform: translateY(-10px); }
</style>