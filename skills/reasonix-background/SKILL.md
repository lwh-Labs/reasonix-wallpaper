---
name: reasonix-background
description: 给 Reasonix 桌面端界面注入动态壁纸背景（读取本机 Wallpaper Engine 库），带悬浮面板可浏览缩略图、点卡片切换、调节不透明度、一键关闭。当用户说"给 Reasonix 换个背景/壁纸""界面太单调""想要动态背景"时使用。
runAs: inline
---

# Reasonix 界面壁纸背景

把 Wallpaper Engine 里的壁纸（高清图层 / 动图 / 视频）变成 Reasonix 窗口的背景。

Reasonix 的插件机制不能加 UI，主题包也只吃静态图，所以这里走的是**注入 `index.html`** 的路线。

## 安装

```powershell
$S = '<插件根目录>\skills\reasonix-background\scripts\install.ps1'
& $S -Apply
```

装完**重启 Reasonix**（或按 Ctrl+R 刷新）。

## 卸载

```powershell
& $S -Restore
```

会还原 `index.html`、删掉 `__rxwallpaper` 目录（含 Junction）、清理旧的 HTTP 服务与自启。

## 状态

```powershell
& $S -Status
```

## 装完是什么样

- 右下角一个壁纸按钮，点开是缩略图网格（带搜索、类型筛选）
- 点卡片立即换背景，选中的高亮标「使用中」
- 面板底部有 **不透明度滑块（20%~100%）** 和 **「关闭壁纸引擎」** 按钮
- `Ctrl + Alt + W` 随时呼出面板
- 选择存在 `localStorage`，重启自动恢复
- 没选壁纸时退回内置的柔光漂移动画

## 实现上的关键决策（改代码前必读）

**1. 资源必须走相对路径 + Junction，不能用 `file://`**

Reasonix 用自定义协议 + `protocol.handle` 从 distRoot 提供页面，`file:///E:/...` 属于跨协议，被 Chromium 直接拦掉（表现是缩略图全裂、点了没反应）。

解决办法是在 `__rxwallpaper\ws` 建一个 **NTFS Junction** 指向 WE 库：

- Junction 不需要管理员权限（符号链接需要，会失败）
- 对文件系统来说它就是 app 目录下的真实子目录，所以相对路径同源可加载
- 一个文件都不用复制，505MB 的视频也能直接用

**2. 不要起本地 HTTP 服务**

试过 `127.0.0.1` 服务供图，但进程会掉线（PowerShell `Start-Process` 的子进程随会话回收，换 WMI 启动也不稳），不如 Junction 干净。

**3. 模糊加在浮层，不能加在内容区**

给 `#root` 加 `backdrop-filter` 会把整张壁纸糊成一团色块。正确做法：

- `.sidebar` / `.composer-card` / `.workspace-panel` → 毛玻璃
- `.chat-pane` / `.chat-transcript` → 完全透明
- 文字可读性靠 `text-shadow`，**不要**靠加深背景

**4. 不透明度和壁纸可见度是乘法关系**

```
壁纸可见度 = (1 − 背景遮罩) × (1 − 面板不透明度)
```

两边都调重 = 壁纸消失。默认基准 0.42，遮罩 0.06~0.18。

**5. scene 壁纸必须从 `scene.pkg` 提取高清层**

WE 的 `preview.gif/jpg` 只有 256×256 ~ 1024×1024，铺到 2K 屏必糊。

`scene.pkg` 是 `PKGV0019` 格式，里面嵌着原始分辨率 PNG（常有 3840 宽）。`extract-hero.mjs` 扫出所有内嵌 PNG，按「面积最大 + 宽高比 1.25~4.5」挑一张（排除 1:1 的材质贴图），转成 2560 宽 jpg。

提取结果按 id 缓存在 `hero/`，第二次跑秒过。

**6. 所有 `.ps1` 必须 UTF-8 BOM**

Windows PowerShell 5.1 读无 BOM 脚本会按 GBK 解析，中文直接让语法崩。

**7. 涉及 Junction 的删除要格外小心**

删 `__rxwallpaper` 前必须先摘掉 Junction（`$it.Delete()`），
否则 `Remove-Item -Recurse` 有可能顺着链接递归进 E 盘删壁纸库。

## 生效机制

`install.ps1` 会往 `app\resources\app\index.html` 注入三个标签：

```html
<link rel="stylesheet" href="./__rxwallpaper/rx-wallpaper.css" />
<script src="./__rxwallpaper/rx-wallpaper-data.js"></script>  <!-- 在 body 末尾 -->
<script src="./__rxwallpaper/rx-wallpaper.js"></script>
```

`data.js` 由脚本扫描 WE 库生成，含每张壁纸的 id / 标题 / 类型 / 缩略图路径 / 背景路径。

## 已知限制

- Reasonix 升级到新版本目录后注入失效，需要重新 `-Apply`
- 少数 scene 壁纸的 pkg 里没有合适的大图层，仍会用低清预览
- 高清层是宽幅（如 2560×789），`object-fit: cover` 会裁掉两侧，构图和桌面实况不完全一致
- 505MB 级别的视频壁纸播放时占内存
