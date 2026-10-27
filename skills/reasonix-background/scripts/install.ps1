#Requires -Version 5.1
<#
.SYNOPSIS
    给 Reasonix 桌面端注入 / 还原「壁纸引擎」面板。

.DESCRIPTION
    Reasonix 的插件机制不能加 UI 面板，主题包也只吃静态图。
    这个脚本往 index.html 里注入一层纯 DOM 的壁纸面板：
    悬浮按钮 + 卡片网格 + 点卡片换背景，动态壁纸用 <video> 播原片。

    资源策略（关键）：
      Reasonix 用自定义协议 + protocol.handle 从 distRoot 提供页面，
      所以 file:///E:/... 属于跨协议，被 Chromium 直接拦掉。
      解决方案是在 __rxwallpaper\ws 下建一个 **Junction**（目录联接）
      指向 Wallpaper Engine 库 —— Junction 无需管理员权限、可跨盘，
      对文件系统来说就是 app 目录下的真实子目录，因此相对路径同源可加载，
      而且**一个文件都不用复制**，505MB 的视频也能直接用。

      缩略图仍然单独生成 320x180：原图动辄 300KB~1MB，35 张一起加载太慢。

.EXAMPLE
    .\install.ps1 -Apply      # 注入 / 建联接 / 生成缩略图
    .\install.ps1 -Restore    # 还原一切
    .\install.ps1 -Status     # 看状态
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Restore,
    [switch]$Status,
    [string]$WorkshopRoot = 'E:\Steam\steamapps\workshop\content\431960',
    [int]$ThumbW = 320,
    [int]$ThumbH = 180
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Marker    = '__rxwallpaper'
$TagAttr   = 'data-rx-wallpaper="1"'
$CssName   = 'rx-wallpaper.css'
$JsName    = 'rx-wallpaper.js'
$DataName  = 'rx-wallpaper-data.js'
# 脚本在 skills/<name>/scripts/，静态资源在同级的 assets/ 下
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AssetSrc  = Join-Path (Split-Path -Parent $ScriptDir) 'assets'
$Here      = $ScriptDir
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-RxAppDir {
    $cands = @()
    foreach ($n in @('Reasonix', 'reasonix-desktop')) {
        $p = Get-Process -Name $n -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($p -and $p.Path) { $cands += (Join-Path (Split-Path -Parent $p.Path) 'resources\app') }
    }
    $verRoot = 'D:\Reasonix\versions'
    if (Test-Path -LiteralPath $verRoot) {
        Get-ChildItem -LiteralPath $verRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | ForEach-Object {
                $cands += (Join-Path $_.FullName 'app\resources\app')
            }
    }
    foreach ($c in $cands) {
        if (Test-Path -LiteralPath (Join-Path $c 'index.html')) { return $c }
    }
    return $null
}

$appDir = Get-RxAppDir
if (-not $appDir) { Write-Output "找不到 Reasonix 的 app 目录。"; exit 1 }

$indexPath  = Join-Path $appDir 'index.html'
$assetDir   = Join-Path $appDir $Marker
$imgDir     = Join-Path $assetDir 'img'
$heroDir    = Join-Path $assetDir 'hero'
$wsLink     = Join-Path $assetDir 'ws'
$backup     = "$indexPath.rxwallpaper.bak"
$startupVbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'reasonix-wallpaper.vbs'

Write-Output "app 目录: $appDir"

function Read-Index { [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8) }
function Test-Injected { (Read-Index).Contains($TagAttr) }

# 安全删除 Junction：只摘链接本身，绝不递归（否则会删掉 E 盘壁纸库！）
function Remove-Junction([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    try {
        $it = Get-Item -LiteralPath $path -Force
        if ($it.LinkType -or $it.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            $it.Delete()
        } else {
            Remove-Item -LiteralPath $path -Recurse -Force
        }
    } catch {
        try { [System.IO.Directory]::Delete($path, $false) } catch {}
    }
}

# ---- 缩略图生成 --------------------------------------------------------
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

function New-Thumb([string]$src, [string]$dest, [int]$w, [int]$h) {
    $img = $null; $bmp = $null; $g = $null
    try {
        $img = [System.Drawing.Image]::FromFile($src)
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::FromArgb(13, 17, 23))

        $sw = [double]$img.Width; $sh = [double]$img.Height
        $scale = [Math]::Max($w / $sw, $h / $sh)
        $dw = [int]($sw * $scale); $dh = [int]($sh * $scale)
        $dx = [int](($w - $dw) / 2); $dy = [int](($h - $dh) / 2)
        $g.DrawImage($img, $dx, $dy, $dw, $dh)

        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                 Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [long]82)
        $bmp.Save($dest, $codec, $ep)
        return $true
    } catch {
        return $false
    } finally {
        if ($g) { $g.Dispose() }
        if ($bmp) { $bmp.Dispose() }
        if ($img) { $img.Dispose() }
    }
}

# 从 scene.pkg 提取原始分辨率图层 -> 转成 2560 宽的 jpg
function Get-HeroImage([string]$pkgPath, [string]$destJpg) {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) { $nodeExe = 'D:\nodejs\node.exe' }
    if (-not (Test-Path -LiteralPath $nodeExe)) { return $false }

    $extractor = Join-Path $Here 'extract-hero.mjs'
    if (-not (Test-Path -LiteralPath $extractor)) { return $false }

    $tmpDir = Join-Path $env:TEMP ('rxwp-hero-' + [guid]::NewGuid().ToString('N'))
    $img = $null; $bmp = $null; $g = $null
    try {
        $raw = & $nodeExe $extractor $pkgPath $tmpDir 2>$null | Out-String
        if (-not $raw.Trim()) { return $false }
        $r = $raw | ConvertFrom-Json
        if (-not $r.ok) { return $false }
        if (-not (Test-Path -LiteralPath $r.out)) { return $false }

        $img = [System.Drawing.Image]::FromFile($r.out)
        $maxW = 2560
        if ($img.Width -le $maxW) { $w = $img.Width; $h = $img.Height }
        else { $w = $maxW; $h = [int]($img.Height * $maxW / $img.Width) }

        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        # 图层可能带透明通道，用主题底色铺底，否则透明区会变纯黑
        $g.Clear([System.Drawing.Color]::FromArgb(255, 7, 8, 11))
        $g.DrawImage($img, 0, 0, $w, $h)

        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                 Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [long]88)
        $bmp.Save($destJpg, $codec, $ep)
        return $true
    } catch {
        return $false
    } finally {
        if ($g) { $g.Dispose() }
        if ($bmp) { $bmp.Dispose() }
        if ($img) { $img.Dispose() }
        if (Test-Path -LiteralPath $tmpDir) {
            Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# ---- 生成资源与数据 ----------------------------------------------------
function New-Assets {
    if (-not (Test-Path -LiteralPath $WorkshopRoot)) {
        Write-Output "  ⚠ 壁纸库不存在: $WorkshopRoot"
        return $false
    }

    # 1) 目录联接：一次建立，全部原文件都变成"app 目录下的文件"
    Remove-Junction $wsLink
    try {
        New-Item -ItemType Junction -Path $wsLink -Target $WorkshopRoot -ErrorAction Stop | Out-Null
        Write-Host "  已建立目录联接 ws -> $WorkshopRoot"
    } catch {
        Write-Host "  ❌ 建立目录联接失败: $($_.Exception.Message)"
        return $false
    }

    # 2) 缩略图目录重建；hero 目录保留（提取很慢，按 id 缓存）
    if (Test-Path -LiteralPath $imgDir) { Remove-Item -LiteralPath $imgDir -Recurse -Force }
    New-Item -ItemType Directory -Path $imgDir -Force | Out-Null
    if (-not (Test-Path -LiteralPath $heroDir)) { New-Item -ItemType Directory -Path $heroDir -Force | Out-Null }

    $rows = New-Object System.Collections.Generic.List[object]
    $thumbOk = 0; $videoN = 0; $gifN = 0; $heroN = 0

    foreach ($dir in Get-ChildItem -LiteralPath $WorkshopRoot -Directory -ErrorAction SilentlyContinue) {
        if ($dir.Name -notmatch '^\d+$') { continue }
        $pj = Join-Path $dir.FullName 'project.json'
        if (-not (Test-Path -LiteralPath $pj)) { continue }
        try { $meta = [System.IO.File]::ReadAllText($pj, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { continue }

        $type = ([string]$meta.type).ToLowerInvariant()
        $file = [string]$meta.file
        $id = $dir.Name

        # 缩略图源：优先 jpg
        $srcThumb = $null
        foreach ($cand in @('preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp', 'preview.gif')) {
            $p = Join-Path $dir.FullName $cand
            if (Test-Path -LiteralPath $p) { $srcThumb = $p; break }
        }
        $thumbRel = $null
        if ($srcThumb) {
            if (New-Thumb $srcThumb (Join-Path $imgDir "$id.jpg") $ThumbW $ThumbH) {
                $thumbRel = "./$Marker/img/$id.jpg"
                $thumbOk++
            }
        }

        # 背景媒体：优先从 scene.pkg 提取的高清图层，其次 video 原片，最后才退到 preview
        $mediaRel = $null
        $mediaKind = 'image'

        if ($type -eq 'video' -and $file) {
            if (Test-Path -LiteralPath (Join-Path $dir.FullName $file)) {
                $mediaRel = "./$Marker/ws/$id/$file"
                $mediaKind = 'video'
                $videoN++
            }
        }

        # scene 壁纸：preview 只有 256~1024，糊得没法看。
        # 试着从 scene.pkg 里挖原始分辨率图层（常有 3840 宽），转成 jpg 当背景。
        if (-not $mediaRel) {
            $heroJpg = Join-Path $heroDir "$id.jpg"
            if (-not (Test-Path -LiteralPath $heroJpg)) {
                $pkg = Join-Path $dir.FullName 'scene.pkg'
                if (Test-Path -LiteralPath $pkg) {
                    if (Get-HeroImage $pkg $heroJpg) { $heroN++ }
                }
            }
            if (Test-Path -LiteralPath $heroJpg) {
                $mediaRel = "./$Marker/hero/$id.jpg"
                $mediaKind = 'image'
            }
        }

        # 没有高清层：退到动图，再退到静态预览
        if (-not $mediaRel) {
            if (Test-Path -LiteralPath (Join-Path $dir.FullName 'preview.gif')) {
                $mediaRel = "./$Marker/ws/$id/preview.gif"
                $gifN++
            } elseif (Test-Path -LiteralPath (Join-Path $dir.FullName 'preview.jpg')) {
                $mediaRel = "./$Marker/ws/$id/preview.jpg"
            } elseif ($thumbRel) {
                $mediaRel = $thumbRel
            }
        }
        if (-not $thumbRel -and -not $mediaRel) { continue }

        $rows.Add([pscustomobject]@{
            id        = $id
            title     = [string]$meta.title
            type      = $type
            tags      = @($meta.tags | Where-Object { $_ })
            thumb     = $thumbRel
            media     = $mediaRel
            mediaKind = $mediaKind
        })
    }

    $parts = @($rows | ForEach-Object { $_ | ConvertTo-Json -Depth 5 -Compress })
    $json = '[' + ($parts -join ',') + ']'
    $content = "/* 由 wallpaper 插件自动生成，勿手改 */`r`nwindow.__RXWP_DATA__ = $json;`r`n"
    [System.IO.File]::WriteAllText((Join-Path $assetDir $DataName), $content, $utf8NoBom)

    Write-Host ('  壁纸 ' + $rows.Count + ' 张｜缩略图 ' + $thumbOk +
                '｜高清层 ' + @(Get-ChildItem -LiteralPath $heroDir -File -ErrorAction SilentlyContinue).Count +
                '｜视频 ' + $videoN + '｜动图 ' + $gifN)
    return $true
}

function Remove-OldService {
    if (Test-Path -LiteralPath $startupVbs) {
        Remove-Item -LiteralPath $startupVbs -Force
        Write-Output "  已移除旧的 HTTP 服务开机自启"
    }
    foreach ($port in @(47822, 47823)) {
        $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($c) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Output "  已停止旧的 HTTP 服务 (port=$port)"
        }
    }
    $oldMedia = Join-Path $assetDir 'media'
    if (Test-Path -LiteralPath $oldMedia) {
        Remove-Item -LiteralPath $oldMedia -Recurse -Force
        Write-Output "  已清理上一版复制进来的媒体文件"
    }
}

# ---- 状态 / 还原 -------------------------------------------------------
if ($Status -or (-not $Apply -and -not $Restore)) {
    Write-Output ""
    Write-Output ("已注入:      {0}" -f (Test-Injected))
    Write-Output ("备份存在:    {0}" -f (Test-Path -LiteralPath $backup))
    $isJ = $false
    if (Test-Path -LiteralPath $wsLink) {
        try { $isJ = [bool](Get-Item -LiteralPath $wsLink -Force).LinkType } catch {}
    }
    Write-Output ("目录联接:    {0}" -f $(if ($isJ) { "是 -> $WorkshopRoot" } else { '否' }))
    if (Test-Path -LiteralPath $imgDir) {
        Write-Output ("  缩略图: {0} 张" -f @(Get-ChildItem -LiteralPath $imgDir -File -ErrorAction SilentlyContinue).Count)
    }
    if (-not $Apply -and -not $Restore) { Write-Output "`n用法: .\install.ps1 -Apply  或  -Restore" }
    return
}

if ($Restore) {
    if (Test-Path -LiteralPath $backup) {
        Copy-Item -LiteralPath $backup -Destination $indexPath -Force
        Write-Output "已从备份还原 index.html"
    } elseif (Test-Injected) {
        $lines = @((Read-Index) -split "`r?`n" | Where-Object { -not $_.Contains($TagAttr) })
        [System.IO.File]::WriteAllText($indexPath, ($lines -join "`r`n"), $utf8NoBom)
        Write-Output "无备份，已手动摘除注入标签"
    } else { Write-Output "没有注入痕迹" }

    Remove-OldService
    if (Test-Path -LiteralPath $assetDir) {
        # 先安全摘掉 junction，再删目录
        Remove-Junction $wsLink
        Remove-Item -LiteralPath $assetDir -Recurse -Force
        Write-Output "已删除 $Marker 目录（含目录联接）"
    }
    Write-Output "还原完成。重启 Reasonix 生效。"
    return
}

# ---- Apply -------------------------------------------------------------
if (-not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $indexPath -Destination $backup -Force
    Write-Output "已备份 index.html"
}
if (-not (Test-Path -LiteralPath $assetDir)) { New-Item -ItemType Directory -Path $assetDir -Force | Out-Null }

Remove-OldService

Write-Output "准备资源…"
if (-not (New-Assets)) { Write-Output "资源准备失败，中止"; exit 1 }

foreach ($f in @($CssName, $JsName)) {
    $src = Join-Path $AssetSrc $f
    if (-not (Test-Path -LiteralPath $src)) { Write-Output "缺少文件: $src"; exit 1 }
    Copy-Item -LiteralPath $src -Destination (Join-Path $assetDir $f) -Force
}
Write-Output "  已写入 $CssName / $JsName"

$html = Read-Index
$lines = @($html -split "`r?`n" | Where-Object { -not $_.Contains($TagAttr) })
$html = $lines -join "`r`n"

$cssTag = "    <link rel=`"stylesheet`" href=`"./$Marker/$CssName`" $TagAttr />"
$jsTags = "    <script src=`"./$Marker/$DataName`" $TagAttr></script>`r`n    <script src=`"./$Marker/$JsName`" $TagAttr></script>"

if (-not $html.Contains('</head>')) { Write-Output "index.html 缺少 </head>，中止"; exit 1 }
$html = $html -replace '(\r?\n)?</head>', ("`r`n" + $cssTag + "`r`n  </head>")

if ($html.Contains('</body>')) {
    $html = $html -replace '(\r?\n)?</body>', ("`r`n" + $jsTags + "`r`n  </body>")
} else {
    $html = $html + "`r`n" + $jsTags
}

[System.IO.File]::WriteAllText($indexPath, $html, $utf8NoBom)
Write-Output "  已注入 index.html"

Write-Output ""
Write-Output "完成。重启 Reasonix 后，右下角会出现壁纸按钮。"
Write-Output "不满意就跑： .\install.ps1 -Restore"
