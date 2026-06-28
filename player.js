const { createApp, ref, nextTick, onMounted } = Vue;

createApp({
    setup() {
        const avatars = {
            "宵崎奏": "chara_icons/chr_ts_17.png",
            "朝比奈真冬": "chara_icons/chr_ts_18.png",
            "东云绘名": "chara_icons/chr_ts_19.png",
            "晓山瑞希": "chara_icons/chr_ts_20.png",
            "初音未来": "chara_icons/chr_ts_21_6.png",
            "镜音铃": "chara_icons/chr_ts_22.png",
            "镜音连": "chara_icons/chr_ts_23.png",
            "巡音流歌": "chara_icons/chr_ts_24.png",
            "MEIKO": "chara_icons/chr_ts_25.png",
            "KAITO": "chara_icons/chr_ts_26.png",
        };
        const themeColor = '#884499';
        const launched = ref(true);
        const songTitle = ref('');
        const songArtist = ref('');
        const coverUrl = ref('');
        const audioSrc = ref('');
        const parsedLyrics = ref([]);
        const currentIndex = ref(-1);
        const currentTime = ref(0);
        const duration = ref(0);
        const progressPercent = ref(0);
        const isPlaying = ref(false);
        const audioLoaded = ref(false);
        const audioError = ref('');

        const audioPlayer = ref(null);
        const lyricsBox = ref(null);

        const xlrcText = ref('');
        const dynamicConfig = ref(null); // { colors: {}, charas: {}, charColors: {} } 覆盖
        const configReady = ref(false);

        // 从 localStorage / lyrics/[id].xlrc 自动加载
        (async function autoLoad() {
            const params = new URLSearchParams(window.location.search);
            const songId = params.get('id');
            if (!songId) return;

            // 1) 优先从 localStorage 读取（由 index.html 跳转触发）
            const raw = localStorage.getItem('pjsk_song_' + songId);
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    songTitle.value = data.title || '';
                    songArtist.value = data.artist || '';
                    coverUrl.value = data.coverUrl || '';
                    audioSrc.value = data.audioUrl || '';
                    xlrcText.value = data.xlrcText || '';
                } catch (e) {
                    console.warn('Parse localStorage failed:', e);
                }
            }

            // 2) 如果还没有歌词，尝试从 lyrics/[id].xlrc 加载
            if (!xlrcText.value) {
                try {
                    const resp = await fetch('lyrics/' + songId + '.xlrc');
                    if (resp.ok) {
                        xlrcText.value = await resp.text();
                    }
                } catch (e) {
                    // 文件不存在，忽略
                }
            }

            // 3) 尝试从歌词头部解析角色映射
            const headersOk = tryParseHeaders(xlrcText.value || '');
            if (headersOk) {
                configReady.value = true;
            }

            // 4) 解析歌词（仅在有歌词时）
            if (audioSrc.value && xlrcText.value && configReady.value) {
                parsexlrc();
                // 默认滚动到第一句实词
                nextTick(() => {
                    const lyrics = parsedLyrics.value;
                    let first = 0;
                    while (first < lyrics.length && lyrics[first].isGap) first++;
                    if (first < lyrics.length) scrollToIndex(first);
                });
            }

            // 5) 自动播放（浏览器可能阻止，静默失败即可）
            if (audioSrc.value) {
                audioLoaded.value = true;
                nextTick(() => {
                    const audio = audioPlayer.value;
                    if (audio) {
                        audio.play().then(() => isPlaying.value = true).catch(() => { });
                    }
                });
            }
        })();

        // 解析 xlrc（@ID 已内联）
        function parsexlrc() {
            const lineRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/;
            const idRegex = /@(\d+)/g;
            const lines = xlrcText.value.trim().split('\n');
            let lastIdSet = new Set();
            const result = [];

            // 合并多个 ID 的所有角色名（去重）。合唱 ID 自动含前面所有角色
            function mergeCharas(ids, dc) {
                const nameMap = new Map(); // name -> color
                const chorusId = dc._chorusId;
                ids.forEach(id => {
                    const charasList = id === chorusId
                        ? Object.keys(dc.charas || {}).reduce((acc, k) => {
                            if (parseInt(k) < parseInt(chorusId)) {
                                acc.push(...(dc.charas?.[k] || []));
                            }
                            return acc;
                        }, [])
                        : (dc.charas?.[id] || []);
                    const colorList = id === chorusId
                        ? Object.keys(dc.charas || {}).reduce((acc, k) => {
                            if (parseInt(k) < parseInt(chorusId)) {
                                acc.push(...(dc.charColors?.[k] || []));
                            }
                            return acc;
                        }, [])
                        : (dc.charColors?.[id] || []);
                    charasList.forEach((n, i) => {
                        const name = n.replace(/\(.*?\)\s*$/, '');
                        if (!nameMap.has(name)) {
                            nameMap.set(name, colorList[i] || '');
                        }
                    });
                });
                const chars = [...nameMap.keys()];
                const charColors = chars.map(name => nameMap.get(name));
                return { chars, charColors };
            }

            lines.forEach(line => {
                const m = line.match(lineRegex);
                if (!m) return;

                const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]) - 0.4; // 提前 400ms
                const rest = m[3].trim();
                if (!rest) { result.push({ time, text: '', isGap: true }); lastIdSet = new Set(); return; }

                const dc = dynamicConfig.value || {};
                const segMatch = [...rest.matchAll(idRegex)];
                let effectiveIds;

                if (segMatch.length === 0) {
                    effectiveIds = [dc._chorusId || "6"];
                } else {
                    effectiveIds = [...new Set(segMatch.map(s => s[1]))];
                }

                const sortedIds = [...effectiveIds].sort();
                const idSetKey = sortedIds.join(',');
                const showAvatar = idSetKey !== [...lastIdSet].sort().join(',');
                lastIdSet = new Set(effectiveIds);

                if (segMatch.length <= 1) {
                    const effectiveId = effectiveIds[0];
                    const text = segMatch.length === 1 ? rest.replace(/@\d+/g, '').trim() : rest;
                    const colorValue = dc.colors ? (dc.colors[effectiveId] || themeColor) : themeColor;
                    const merged = mergeCharas(effectiveIds, dc);
                    result.push({
                        time, text, id: effectiveId,
                        showAvatar, color: colorValue,
                        isGradient: typeof colorValue === 'string' && colorValue.startsWith('linear-gradient'),
                        chars: merged.chars, charColors: merged.charColors,
                    });
                } else {
                    const segments = [];
                    for (let i = 0; i < segMatch.length; i++) {
                        const segId = segMatch[i][1];
                        const endIdx = i + 1 < segMatch.length ? segMatch[i + 1].index : rest.length;
                        const segText = rest.substring(segMatch[i].index + segMatch[i][0].length, endIdx).trim();
                        if (!segText) continue;
                        const cv = dc.colors ? (dc.colors[segId] || themeColor) : themeColor;
                        segments.push({ text: segText, id: segId, color: cv, isGradient: typeof cv === 'string' && cv.startsWith('linear-gradient') });
                    }
                    const merged = mergeCharas(effectiveIds, dc);
                    const fullText = rest.replace(/@\d+/g, '').trim();
                    const firstColor = segments[0]?.color || themeColor;
                    result.push({
                        time, text: fullText, segments,
                        id: effectiveIds[0], showAvatar,
                        color: firstColor,
                        isGradient: typeof firstColor === 'string' && firstColor.startsWith('linear-gradient'),
                        chars: merged.chars, charColors: merged.charColors,
                    });
                }
            });

            parsedLyrics.value = result;
        }

        // 歌词头部解析（|colors= / |charas=）
        function tryParseHeaders(text) {
            const colorsMatch = text.match(/^\|colors=\s*(.+)$/m);
            const charasMatch = text.match(/^\|charas=\s*(.+)$/m);
            if (!colorsMatch || !charasMatch) { dynamicConfig.value = null; return false; }

            const colorsRaw = colorsMatch[1].split(/;\s*/).map(s => s.trim()).filter(Boolean);
            const charasRaw = charasMatch[1].split(/[；;]\s*/).map(s => s.trim()).filter(Boolean);

            const result = { colors: {}, charas: {}, charColors: {}, _chorusId: null };
            colorsRaw.forEach((c, i) => {
                const id = String(i + 1);
                const color = c.replace(/^lg\(/, 'linear-gradient(180deg,').replace(/\)$/, ')');
                result.colors[id] = color || '#999999';

                const chStr = charasRaw[i] || '';
                if (chStr.includes('@nolink') || chStr === '') {
                    result.charas[id] = [];
                    result.charColors[id] = [];
                    if (!result._chorusId) result._chorusId = id;
                } else {
                    const names = chStr.split(/[、,，]\s*/).map(s => s.trim().replace(/\(.*?\)\s*$/, '')).filter(Boolean);
                    result.charas[id] = names;
                    if (names.length === 1) {
                        result.charColors[id] = [color];
                    } else if (c.startsWith('lg(')) {
                        // 从 lg(#c1, #c2, ...) 中提取各角色对应的颜色
                        const inner = c.replace(/^lg\(/, '').replace(/\)$/, '');
                        const lgColors = inner.split(',').map(s => s.trim());
                        result.charColors[id] = names.map((_, i) => lgColors[i] || '');
                    } else {
                        result.charColors[id] = names.map(() => color);
                    }
                }
            });

            dynamicConfig.value = result;
            configReady.value = true;
            return true;
        }

        // 工具
        function formatTime(s) {
            if (!s || !isFinite(s)) return '0:00';
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60).toString().padStart(2, '0');
            return m + ':' + sec;
        }


        function togglePlay() {
            const audio = audioPlayer.value;
            if (!audio) return;
            if (audio.paused) {
                audio.play().catch(() => { });
            } else {
                audio.pause();
            }
        }
        function onAudioError() {
            audioError.value = '音频加载失败，请手动选择本地文件';
            audioLoaded.value = false;
        }
        function onLoadedMeta() {
            const audio = audioPlayer.value;
            if (audio) { duration.value = audio.duration; audioLoaded.value = true; audioError.value = ''; }
        }

        function onTimeUpdate() {
            const audio = audioPlayer.value;
            if (!audio) return;
            const t = audio.currentTime;
            currentTime.value = t;
            if (duration.value > 0) {
                progressPercent.value = (t / duration.value) * 100;
            }

            const lyrics = parsedLyrics.value;
            let idx = lyrics.findIndex(l => l.time > t) - 1;
            if (idx === -2) idx = lyrics.length - 1;
            if (idx < 0) idx = -1;

            if (idx < 0) return;
            const line = lyrics[idx];

            if (line.isGap) {
                // 间奏：焦点停留在空行上
                if (currentIndex.value !== idx) {
                    currentIndex.value = idx;
                    scrollToCurrent();
                }
            } else {
                // 实词：正常高亮 + 滚动
                if (idx !== currentIndex.value) {
                    currentIndex.value = idx;
                    scrollToCurrent();
                }
            }
        }

        function onEnded() {
            progressPercent.value = 100;
        }

        function scrollToCurrent() {
            nextTick(() => {
                const el = getLineEl(currentIndex.value);
                if (!el) return;
                centerLine(el);
            });
        }
        function scrollToIndex(n) {
            nextTick(() => {
                const el = getLineEl(n);
                if (!el) return;
                centerLine(el);
            });
        }
        function getLineEl(idx) {
            const box = lyricsBox.value;
            if (!box || idx < 0) return null;
            return box.querySelectorAll('.lyric-line')[idx];
        }
        function centerLine(el) {
            const box = lyricsBox.value;
            if (!box) return;
            // 以 .lyric-text 顶端为基准
            const LINE_H = 64; // 40px * 1.6 line-height
            const textEl = el.querySelector('.lyric-text');
            const targetTop = (textEl ? textEl.offsetTop : el.offsetTop + 10) - LINE_H * 2;
            box.scrollTo({ top: targetTop, behavior: 'smooth' });
        }

        function seekAudio(e) {
            const bar = e.currentTarget;
            const rect = bar.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            const audio = audioPlayer.value;
            if (audio && duration.value > 0) {
                audio.currentTime = ratio * duration.value;
            }
        }

        function seekTo(t) {
            const audio = audioPlayer.value;
            if (audio && t != null) audio.currentTime = t;
        }

        function playFrom(t) {
            const audio = audioPlayer.value;
            if (!audio || t == null) return;
            audio.currentTime = t;
            audio.play().catch(() => { });
        }

        // 键盘控制
        onMounted(() => {
            document.addEventListener('keydown', (e) => {
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                const audio = audioPlayer.value;
                if (!audio) return;

                if (e.code === 'Space' || (e.shiftKey && e.code === 'KeyP')) {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePlay();
                } else if (e.code === 'Escape') {
                    e.preventDefault();
                    window.location.href = 'index.html';
                } else if (e.code === 'ArrowLeft') {
                    e.preventDefault();
                    audio.currentTime = Math.max(0, audio.currentTime - 5);
                } else if (e.code === 'ArrowRight') {
                    e.preventDefault();
                    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
                }
            });
        });

        return {
            avatars,
            launched,
            songTitle, songArtist,
            parsedLyrics,
            currentIndex,
            currentTime, duration, progressPercent,
            coverUrl, audioSrc,
            isPlaying, audioLoaded, audioError,
            audioPlayer, lyricsBox,
            xlrcText, configReady,
            formatTime,
            togglePlay,
            onAudioError,
            onLoadedMeta,
            onTimeUpdate, onEnded,
            seekAudio, seekTo, playFrom,
        };
    }
}).mount('#app');