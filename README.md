# 🎵 PJSK Player

基于 Web 的《世界计划 多彩舞台！ feat. 初音未来》歌曲播放器，支持多角色分词着色歌词展示。

## ✨ 主要功能

- 🎧 **歌曲库浏览** — 封面墙展示，自由选择歌曲
- 🎤 **分词着色歌词** —  特殊歌词格式，按角色分色显示
- 👤 **角色头像** — 演唱角色切换时自动显示对应头像
- 🎨 **25时主题** — 暗色紫调 UI~~,可切换至其他团体 (计划中)~~
- ⌨️ **键盘控制** — 空格播放/暂停，← → 快进快退
- 📱 **响应式** — 适配桌面、平板、手机，竖屏自动切换纯歌词模式

## 🚀 快速开始

1. 将项目放在任意静态服务器下（如 Nginx、Python http.server 等）
2. 打开 `main.html` 浏览歌曲库
3. 点击封面进入播放器

```bash
# 示例：Python 本地服务器
python -m http.server 8080
# 然后访问 http://localhost:8080/main.html
```

## 📁 项目结构

```text
PJSK Player/
├── main.html          # 歌曲库浏览页
├── player.html        # 播放器页面（Vue 3）
├── player.js          # 播放器逻辑
├── player.css         # 播放器样式
├── songs.json         # 歌曲元数据
├── jacket/            # 专辑封面
├── lyrics/            # 歌词文件
├── chara_icons/       # 角色头像
└── .gitignore
```

> 📖 歌曲配置、歌词格式、切换团体等自定义指南详见 [CUSTOM.md](./CUSTOM.md)

## 📄 许可

个人学习/娱乐项目，歌曲版权归原作者所有。
