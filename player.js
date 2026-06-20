const { createApp, ref, nextTick, onMounted } = Vue;

createApp({
    setup() {
        // ═══════════════════════════════════════════
        // 配置（仅头像 URL，角色映射由用户提供）
        // ═══════════════════════════════════════════
        //
        // TODO: 支持其他《世界计划》团体
        //   想切换团体时，只需改这里：
        //     1. avatars → 对应团体的角色名和 chr_ts_XX 编号
        //     2. defaultColor → 对应团体的主题色
        //     3. CSS 中 :root { --theme: ... } → 对应团体的主题色
        //
        //   团体角色 chr_ts_ 编号速查：
        //     Leo/need          : 1=星乃一歌, 2=天马咲希, 3=望月穗波, 4=日野森志步
        //     MORE MORE JUMP!   : 5=花里实乃理, 6=桐谷遥, 7=桃井爱莉, 8=日野森雫
        //     Vivid BAD SQUAD   : 9=小豆泽心羽, 10=白石杏, 11=东云彰人, 12=青柳冬弥
        //     Wonderlands×Showtime: 13=天马司, 14=凤笑梦, 15=草薙宁宁, 16=神代类
        //     25時、ナイトコードで。: 17=宵崎奏, 18=朝比奈真冬, 19=东云绘名, 20=晓山瑞希
        //     虚拟歌手           : 21=初音未来, 22=镜音铃, 23=镜音连, 24=巡音流歌, 25=MEIKO, 26=KAITO
        //
        const avatars = {
            "宵崎奏":   "chara_icons/chr_ts_17.png",
            "朝比奈真冬": "chara_icons/chr_ts_18.png",
            "东云绘名":  "chara_icons/chr_ts_19.png",
            "晓山瑞希":  "chara_icons/chr_ts_20.png",
            "初音未来": "chara_icons/chr_ts_21_6.png",
            "镜音铃":  "chara_icons/chr_ts_22.png",
            "镜音连":  "chara_icons/chr_ts_23.png",
            "巡音流歌": "chara_icons/chr_ts_24.png",
            "MEIKO":  "chara_icons/chr_ts_25.png",
            "KAITO":  "chara_icons/chr_ts_26.png",
        };
        const defaultColor = '#884499';

        // ═══════════════════════════════════════════
        // xlrc
        // ═══════════════════════════════════════════

        // ═══════════════════════════════════════════
        // 状态
        // ═══════════════════════════════════════════
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

        // ═══════════════════════════════════════════
        // 从 localStorage / lyrics/[id].xlrc 自动加载
        // ═══════════════════════════════════════════
        (async function autoLoad() {
            const params = new URLSearchParams(window.location.search);
            const songId = params.get('id');
            if (!songId) return;

            // 1) 优先从 localStorage 读取（由 main.html 跳转触发）
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
            }

            // 5) 自动播放
            if (audioSrc.value) {
                audioLoaded.value = true;
                nextTick(() => {
                    const audio = audioPlayer.value;
                    if (audio) {
                        audio.play().catch(() => {});
                    }
                });
            }
        })();

        // ═══════════════════════════════════════════
        // 解析 xlrc（@ID 已内联）
        // ═══════════════════════════════════════════
        function parsexlrc() {
            const lineRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/;
            const idRegex = /@(\d+)/g;
            const lines = xlrcText.value.trim().split('\n');
            let lastIdSet = new Set();
            const result = [];

            // 合并多个 ID 的所有角色名（去重）。合唱 ID 自动含前面所有角色
            function mergeCharas(ids, dc) {
                const names = new Set();
                const chorusId = dc._chorusId;
                ids.forEach(id => {
                    if (id === chorusId) {
                        // 合唱：取 chorusId 之前所有 ID 的角色
                        Object.keys(dc.charas || {}).forEach(k => {
                            if (parseInt(k) < parseInt(chorusId)) {
                                (dc.charas?.[k] || []).forEach(n => names.add(n.replace(/\(.*?\)\s*$/, '')));
                            }
                        });
                    } else {
                        (dc.charas?.[id] || []).forEach(n => names.add(n.replace(/\(.*?\)\s*$/, '')));
                    }
                });
                const arr = [...names];
                const colors = ids.length > 0
                    ? arr.map(() => '')
                    : [];
                return { chars: arr, charColors: colors };
            }

            lines.forEach(line => {
                const m = line.match(lineRegex);
                if (!m) return;

                const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]) - 0.3; // 提前 300ms
                const rest = m[3].trim();
                if (!rest) { result.push({ time, text: '', isGap: true }); return; }

                const dc = dynamicConfig.value || {};
                const segMatch = [...rest.matchAll(idRegex)];
                let effectiveIds;

                if (segMatch.length === 0) {
                    effectiveIds = [dc._chorusId || "6"];
                } else {
                    effectiveIds = [...new Set(segMatch.map(s => s[1]))];
                }

                const idSetKey = effectiveIds.sort().join(',');
                const showAvatar = idSetKey !== [...lastIdSet].sort().join(',');
                lastIdSet = new Set(effectiveIds);

                if (segMatch.length <= 1) {
                    const effectiveId = effectiveIds[0];
                    const text = segMatch.length === 1 ? rest.replace(/@\d+/g, '').trim() : rest;
                    const colorValue = dc.colors ? (dc.colors[effectiveId] || defaultColor) : defaultColor;
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
                        const endIdx = i + 1 < segMatch.length ? segMatch[i+1].index : rest.length;
                        const segText = rest.substring(segMatch[i].index + segMatch[i][0].length, endIdx).trim();
                        if (!segText) continue;
                        const cv = dc.colors ? (dc.colors[segId] || defaultColor) : defaultColor;
                        segments.push({ text: segText, id: segId, color: cv, isGradient: typeof cv === 'string' && cv.startsWith('linear-gradient') });
                    }
                    const merged = mergeCharas(effectiveIds, dc);
                    const fullText = rest.replace(/@\d+/g, '').trim();
                    const firstColor = segments[0]?.color || defaultColor;
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

        // ═══════════════════════════════════════════
        // 歌词头部解析（|colors= / |charas=）
        // ═══════════════════════════════════════════
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
                    } else {
                        result.charColors[id] = names.map(() => '');
                    }
                }
            });

            dynamicConfig.value = result;
            configReady.value = true;
            return true;
        }

        // ═══════════════════════════════════════════
        // 工具
        // ═══════════════════════════════════════════
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
                audio.play().catch(() => {});
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
                // 间奏：取消高亮，滚动到下一实词
                currentIndex.value = -1;
                let next = idx + 1;
                while (next < lyrics.length && lyrics[next].isGap) next++;
                if (next < lyrics.length) scrollToIndex(next);
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
            // 以 .lyric-text 顶端为基准，不含上方头像区域
            const textEl = el.querySelector('.lyric-text');
            const boxH = box.clientHeight;
            const targetTop = (textEl ? textEl.offsetTop : el.offsetTop + 10) - boxH / 2 + 72;
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
            audio.play().catch(() => {});
        }

        // ═══════════════════════════════════════════
        // 键盘控制
        // ═══════════════════════════════════════════
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