---
name: desktop-wallpaper
description: 管理本机 Wallpaper Engine 桌面壁纸：列出/搜索创意工坊壁纸、按 ID 或标题切换、查看当前播放、暂停静音，也可以起一个缩略图网格页面手动挑。当用户要换 Windows 桌面壁纸、找某张壁纸、问现在放的是什么时使用。
runAs: inline
---

# Wallpaper Engine 桌面壁纸管理

管的是 **Windows 桌面**上 WE 正在放什么。想给 Reasonix 界面换背景请用 `reasonix-background`。

## 本机环境（首次使用请先核实）

| 项 | 默认值 |
| --- | --- |
| WE 安装目录 | `E:\Steam\steamapps\common\wallpaper_engine` |
| 壁纸库 | `E:\Steam\steamapps\workshop\content\431960` |
| 可执行 | `wallpaper64.exe` |
| 配置文件 | `<WE 安装目录>\config.json` |

路径不同就改脚本顶部的常量，或传 `-WorkshopRoot`。

## 命令行

```powershell
$W = '<插件根目录>\skills\desktop-wallpaper\scripts\wallpaper.ps1'
Set-ExecutionPolicy -Scope Process Bypass -Force -ErrorAction SilentlyContinue
```

| 命令 | 作用 |
| --- | --- |
| `& $W list` | 列出全部壁纸 |
| `& $W list -WallpaperType video` | 按类型过滤：`scene` `video` `web` `application` |
| `& $W list -Tag Anime` | 按标签过滤 |
| `& $W search 鲸` | 按标题或 ID 搜索 |
| `& $W current` | 当前每个显示器放的是什么 |
| `& $W set 3113287126` | 按 ID 切换 |
| `& $W set Dome` | 按标题关键词切换（多命中会列候选） |
| `& $W set Dome -MonitorIndex 1` | 只切某一个显示器 |
| `& $W set Dome -DryRun` | 只打印命令不执行 |
| `& $W pause` / `play` / `stop` | 暂停 / 继续 / 停止 |
| `& $W mute` / `unmute` | 静音 / 取消静音 |

## 图形界面

带缩略图网格的本地网页，点卡片直接换桌面壁纸：

```powershell
node '<插件根目录>\skills\desktop-wallpaper\scripts\viewer.mjs'
```

默认 <http://127.0.0.1:47821/>，会自动开浏览器。也可以双击同目录的 `start-viewer.cmd`。

## 几条必须知道的规则

**1. `-file` 传什么取决于类型**
`scene` 传 `project.json`；`video` 传 `.mp4`；`web` 传 `index.html`。脚本已按 `project.json` 的 `type` 自动算好。

**2. WE 必须已经在运行**
CLI 只是消息通道，不会启动 WE。

```powershell
Get-Process wallpaper64, wallpaper32 -ErrorAction SilentlyContinue
```

**3. 连续切换会崩，必须节流**
脚本和 viewer 都内置 900ms 间隔。官方 issue 和 Rainmeter 社区都报告过 `openWallpaper` 发太快让 WE 崩溃。

**4. `current` 有延迟**
读的是 `config.json`，WE 是异步写这个文件的。刚切完立刻读可能还是旧值，等 3~5 秒。

**5. 双屏要分别设置**
`-monitor 0` / `-monitor 1` 各调一次。不传 `-monitor` 时 WE 只作用于第一个显示器。

**6. 路径含中文和空格是常态**
脚本用数组传参由 PowerShell 加引号；手写命令时**必须用双引号**，单引号 WE 不认。

**7. 脚本必须保留 UTF-8 BOM**
Windows PowerShell 5.1 读无 BOM 脚本会按 GBK 解析，中文注释直接让语法崩。

## 原始命令

```powershell
$exe = 'E:\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe'
& $exe -control openWallpaper -file "E:\Steam\steamapps\workshop\content\431960\3113287126\project.json" -monitor 0
```

其它 control 值：`pause` `stop` `play` `mute` `unmute` `closeWallpaper` `openPlaylist -playlist "<名字>"` `applyProperties -properties "RAW~({...})~END"`。

官方文档：<https://help.wallpaperengine.io/en/functionality/cli.html>

## 不要做

- **不要直接改 `config.json`** 换壁纸，WE 运行时会覆写
- **不要动 `projects\defaultprojects`**，也别清理 `workshop\content\431960`（Steam 管的）
- **不要在用户没要求时切换壁纸**
- **不要删 `wallpaperconfigrecent`**，那是给用户回滚用的
