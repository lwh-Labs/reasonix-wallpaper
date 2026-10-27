# Reasonix Wallpaper

**中文** | [English](./README.en.md)

把 **Wallpaper Engine** 的壁纸搬进 **Reasonix** 桌面端的界面里，当动态背景用。

附赠一个管理 Windows 桌面壁纸的能力。

```
┌─────────────────────────────────────────────────────────┐
│  ▍侧边栏（毛玻璃）        │  聊天区（壁纸直接透出来）      │
│  ▍                      │                              │
│  ▍ 默认工作区            │   你的壁纸在这里当背景         │
│  ▍   Greeting           │   文字靠阴影保证可读           │
│  ▍                      │                              │
│                          │  ┌────────────────────────┐  │
│                          │  │ 输入框（毛玻璃）        │  │
│                          │  └────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 为什么会有这个

Reasonix 的插件机制只能贡献 skills / commands / hooks / MCP，没有 UI 挂载点；内置的主题包机制又只接受静态图片（`png/jpg/jpeg/webp`），塞不进你 Wallpaper Engine 库里那些会动的东西。

所以这个插件走的是**注入 `index.html`** 的路线：往页面里加一层纯 DOM 的壁纸面板，不依赖 React、不改动任何原有逻辑，出错最多背景不显示，不会影响 Reasonix 本身。

## 能力

| | |
|---|---|
| **界面背景** | 从 WE 库读取壁纸当 Reasonix 背景，支持静态图层 / 动图 / 视频 |
| **悬浮面板** | 右下角按钮或 `Ctrl+Alt+W`，缩略图网格，点卡片立即切换 |
| **可调不透明度** | 滑块 20%~100%，实时生效，记住选择 |
| **高清提取** | 从 `scene.pkg` 里挖原始分辨率图层，比 WE 自带的 256×256 预览图清晰 20 倍 |
| **桌面壁纸** | 顺带能命令行 / 图形界面切换 Windows 桌面壁纸 |

## 环境要求

- Windows
- Reasonix 桌面版（在 `v1.39.7` 上验证）
- Wallpaper Engine（Steam 版）
- Node.js（`extract-hero.mjs` 和壁纸选择页面要用）

默认路径按 `E:\Steam\steamapps\common\wallpaper_engine` 写死，装在别处的话改 `scripts/install.ps1` 顶部的 `$WorkshopRoot`。

## 安装

```powershell
# 1) 装进 Reasonix（直接从 GitHub）
reasonix plugin install https://github.com/lwh-Labs/reasonix-wallpaper --yes

# 2) 注入背景层
& "<Reasonix home>\plugins\reasonix-wallpaper\skills\reasonix-background\scripts\install.ps1" -Apply

# 3) 重启 Reasonix（或 Ctrl+R）
```

装完右下角会出现一个壁纸按钮。

## 使用

- **换背景**：点右下角按钮 → 点任意卡片
- **调透明度**：面板底部滑块，往左壁纸更明显，往右面板更实
- **临时呼出**：`Ctrl + Alt + W`
- **关掉**：面板底部「关闭壁纸引擎」，之后再按 `Ctrl+Alt+W` 可以打开

## 卸载

```powershell
& "...\scripts\install.ps1" -Restore
```

会还原 `index.html`、删掉 `__rxwallpaper` 目录（含 Junction）、清掉遗留的服务和自启。

**注意**：卸载脚本会先安全摘掉 Junction 再删目录，不会顺着链接递归进壁纸库。

---

## 工作原理（踩坑记录）

这部分是实现过程中真正花时间的部分，如果你要改代码，先看这里。

### 1. 为什么不能用 `file://` 加载壁纸

最开始的想法很简单：`<img src="file:///E:/Steam/.../preview.jpg">`。

结果**缩略图全裂、点卡片毫无反应**。

原因：Reasonix 不用 `file://` 加载页面，而是注册了一个自定义协议：

```js
protocol.registerSchemesAsPrivileged([{ scheme: ur, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }])
protocol.handle(ur, async e => { const t = ca(e.url, r.distRoot, la); ... })
```

页面的所有资源都由 `distRoot`（`app\resources\app`）提供。`file:///E:/...` 属于**跨协议**，被 Chromium 直接拦掉——而且不报错，静默失败。

### 2. 解决方案：NTFS Junction

在 `__rxwallpaper\ws` 建一个 Junction 指向 WE 库：

```
app\resources\app\__rxwallpaper\ws  ⟶  E:\Steam\steamapps\workshop\content\431960
```

Junction 是文件系统级的东西，不是快捷方式。对任何程序（包括 Chromium 的路径校验）来说，它就是 app 目录下的一个真实子目录，所以：

- 路径是 `./__rxwallpaper/ws/3305590289/xxx.mp4` → 同源，能加载 ✓
- 但一个文件都不占空间，505MB 的视频也能直接用 ✓

**为什么不用符号链接**：Windows 上创建符号链接需要管理员权限（`A required privilege is not held by the client`）。Junction 不需要。

### 3. 为什么放弃了「本地 HTTP 服务」方案

试过起一个 `127.0.0.1:47822` 的服务供图，路由 `/t/<id>` 和 `/m/<id>`，Range、CORS、路径穿越防护都做了。

问题是**进程活不住**：

- `Start-Process` 启动的子进程会随 PowerShell 会话结束被回收
- 换 WMI `Win32_Process.Create` 能跨会话存活，但重启 Reasonix 之后又不稳定

一个会掉线的服务比 Junction 差远了。Junction 零进程、零端口、零维护。

### 4. scene 壁纸为什么一开始是糊的

WE 的 `preview.gif` / `preview.jpg` 是**缩略图**，不是画面本身：

| 壁纸 | 缩略图分辨率 |
|---|---|
| Dome 4k | 256×256 |
| The Dark Night | 755×755 |
| 桜 | 1024×1024 |

铺到 2K 屏上就是放大 10 倍，糊是必然的，跟 CSS 没关系。

真正的高清图藏在 `scene.pkg` 里。那是 `PKGV0019` 格式，29MB 上下，里面嵌着原始分辨率的 PNG 图层：

```
文件头: 08 00 00 00  50 4B 47 56 30 30 31 39
                     P  K  G  V  0  0  1  9
```

`extract-hero.mjs` 干的事：扫出所有内嵌 PNG（按 `89 50 4E 47` … `49 45 4E 44` 界定），读 IHDR 拿宽高，挑「面积最大 + 宽高比 1.25~4.5」的那张。

排除 1:1 是为了避开方形材质贴图（石头、木纹那种），单看不是画面。

实测效果：

```
Dome 4k       → 3840×1184 的地球太空夜景（缩略图 256×256）
桜            → 3507×2200
```

转成 2560 宽 jpg 存进 `hero/`，按 id 缓存，第二次跑秒过。31 张 scene 里 22 张能挖到高清层。

### 5. 模糊加错地方，壁纸就废了

这是最容易踩的坑。最初给 `#root` 整体加了 `backdrop-filter: blur(24px)`，想着"虚化背景让文字清楚"。

结果：**整张壁纸被糊成一团色块，什么都看不见**。

正确的做法是分层：

```css
/* 浮层加毛玻璃 */
.sidebar, .composer-card, .workspace-panel {
  backdrop-filter: blur(22px) saturate(1.3);
}

/* 内容区完全透明 */
.chat-pane, .chat-transcript, .chat-surface {
  background: transparent !important;
}

/* 文字可读性靠阴影，不靠加深背景 */
body {
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
```

类名是从 Reasonix 的样式产物（`styles-*.css`，851KB，3930 个类名）里扒出来的。

### 6. 不透明度和壁纸可见度是乘法关系

```
壁纸可见度 = (1 − 背景遮罩) × (1 − 面板不透明度)
```

面板的"半透明层"**本身是黑色**——50% 不透明度不是"透出一半壁纸"，而是"盖了半层黑纱"。

两边都调重，壁纸直接消失。当前默认：面板基准 0.42，遮罩 0.06~0.18。

### 7. 两个平台陷阱

**`-notlike '?*'` 里的 `?` 是通配符**，会匹配任何非空串，导致 WE 的 `config.json` 用户键全被过滤掉、读不到当前壁纸。要用 `.StartsWith('?')`。

**`.ps1` 必须 UTF-8 BOM**。Windows PowerShell 5.1 读无 BOM 脚本会按 GBK 解析，中文注释直接让语法崩，报一堆看不懂的"缺少终止符"。

---

## 已知限制

- Reasonix 升级到新版本目录后注入失效，需要重新 `-Apply`（脚本会自动找最新的 `versions\v*`）
- 少数 scene 壁纸的 pkg 里没有合适的大图层，仍会用低清预览
- 高清层常是宽幅（如 2560×789），`object-fit: cover` 会裁掉两侧，构图和桌面实时渲染不完全一致
- 超大视频壁纸（500MB+）播放时占用内存明显
- 只在 Reasonix `v1.39.7` / Windows 上验证过，其他版本可能因为类名变化导致毛玻璃不生效（不影响功能）

## 目录

```
reasonix-wallpaper/
  reasonix-plugin.json
  skills/
    reasonix-background/          Reasonix 界面背景
      SKILL.md
      assets/
        rx-wallpaper.css          注入的样式（毛玻璃 / 面板 / 变量覆盖）
        rx-wallpaper.js           注入的逻辑（面板 / 切换 / 滑块）
      scripts/
        install.ps1               注入 / 还原 / 状态
        extract-hero.mjs          从 scene.pkg 提取高清图层
    desktop-wallpaper/            Windows 桌面壁纸
      SKILL.md
      scripts/
        wallpaper.ps1             命令行：list / search / set / current / pause…
        viewer.mjs                缩略图网格页面（Node，零依赖）
        viewer.html
        start-viewer.cmd
```

## License

MIT
