#Requires -Version 5.1
<#
.SYNOPSIS
    Wallpaper Engine 控制脚本（本机 Steam 库）。

.DESCRIPTION
    为 Reasonix `wallpaper` skill 提供确定性的操作入口。只做四件事：
    读壁纸库、查当前壁纸、切换壁纸、控制播放。

    所有切换都走 WE 官方 CLI（-control openWallpaper），不直接改 config.json，
    因为 WE 运行时会覆盖该文件。

.EXAMPLE
    .\wallpaper.ps1 list
    .\wallpaper.ps1 list -WallpaperType video
    .\wallpaper.ps1 search 鲸
    .\wallpaper.ps1 set 3113287126
    .\wallpaper.ps1 set Dome -DryRun
    .\wallpaper.ps1 current
    .\wallpaper.ps1 pause
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('list', 'search', 'set', 'current', 'pause', 'play', 'stop', 'mute', 'unmute', 'monitors')]
    [string]$Command = 'list',

    [Parameter(Position = 1)]
    [string]$Query,

    # -1 = 未指定；指定时只作用于该显示器
    [int]$MonitorIndex = -1,

    [ValidateSet('scene', 'video', 'web', 'application')]
    [string]$WallpaperType,

    [string]$Tag,

    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---- 本机环境常量 -------------------------------------------------------
$WEEngine = 'E:\Steam\steamapps\common\wallpaper_engine'
$Workshop = 'E:\Steam\steamapps\workshop\content\431960'
$ExePath  = Join-Path $WEEngine 'wallpaper64.exe'
$CfgPath  = Join-Path $WEEngine 'config.json'

# WE 连续收到 openWallpaper 会崩溃，官方 issue 与 Rainmeter 社区均有报告
$ThrottleMs = 900

# ---- helpers ------------------------------------------------------------
function Read-JsonUtf8 {
    param([string]$Path)
    $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return $raw | ConvertFrom-Json
}

function Get-WallpaperLibrary {
    $list = New-Object System.Collections.Generic.List[object]
    if (-not (Test-Path -LiteralPath $Workshop)) { return $list }

    foreach ($dir in Get-ChildItem -LiteralPath $Workshop -Directory -ErrorAction SilentlyContinue) {
        $pj = Join-Path $dir.FullName 'project.json'
        if (-not (Test-Path -LiteralPath $pj)) { continue }
        try { $meta = Read-JsonUtf8 $pj } catch { continue }

        $kind = ([string]$meta.type).ToLowerInvariant()
        $file = [string]$meta.file

        # 官方 CLI：scene 传 project.json；video 传 .mp4；web 传 index.html
        switch ($kind) {
            'scene' { $target = $pj }
            'video' { $target = if ($file) { Join-Path $dir.FullName $file } else { $null } }
            'web'   { $target = if ($file) { Join-Path $dir.FullName $file } else { $null } }
            default { $target = if ($file) { Join-Path $dir.FullName $file } else { $pj } }
        }

        $list.Add([pscustomobject]@{
            Id      = $dir.Name
            Title   = [string]$meta.title
            Type    = $kind
            Tags    = (@($meta.tags) -join '/')
            Target  = $target
            Preview = if ($meta.preview) { Join-Path $dir.FullName ([string]$meta.preview) } else { $null }
        })
    }
    return $list
}

function Get-CurrentMap {
    # 返回 @{ 'Monitor0' = 'E:\...\431960\<id>\scene.pkg' ... }
    $map = @{}
    if (-not (Test-Path -LiteralPath $CfgPath)) { return $map }
    try { $cfg = Read-JsonUtf8 $CfgPath } catch { return $map }

    # config.json 顶层：一个以 Steam 用户名命名的键 + 一个 "?installdirectory"
    # 注意：不能用 -notlike '?*' —— ? 在 -like 里是通配符，会匹配任何非空串
    $userKey = $cfg.PSObject.Properties.Name | Where-Object { -not $_.StartsWith('?') } | Select-Object -First 1
    if (-not $userKey) { return $map }

    $sel = $cfg.$userKey.general.wallpaperconfig.selectedwallpapers
    if (-not $sel) { return $map }

    foreach ($p in $sel.PSObject.Properties) {
        $f = [string]$p.Value.file
        if ($f) { $map[$p.Name] = $f }
    }
    return $map
}

function Resolve-Wallpaper {
    param($Library, [string]$Needle)
    if ([string]::IsNullOrWhiteSpace($Needle)) { return @() }
    $byId = @($Library | Where-Object { $_.Id -eq $Needle })
    if ($byId.Count -gt 0) { return $byId }
    return @($Library | Where-Object { $_.Title -like "*$Needle*" })
}

function Invoke-WeControl {
    param([string[]]$WeArgs)
    if (-not (Test-Path -LiteralPath $ExePath)) { throw "找不到 wallpaper64.exe: $ExePath" }
    if ($DryRun) {
        Write-Output ("  [DryRun] `"$ExePath`" " + ($WeArgs -join ' '))
        return
    }
    & $ExePath @WeArgs
    Start-Sleep -Milliseconds $ThrottleMs
}

function Get-TargetMonitors {
    $cur = Get-CurrentMap
    $names = @($cur.Keys | Sort-Object)
    if ($names.Count -eq 0) { $names = @('Monitor0') }
    if ($MonitorIndex -ge 0) { return @("Monitor$MonitorIndex") }
    return $names
}

# ---- 命令实现 -----------------------------------------------------------
$lib = Get-WallpaperLibrary

switch ($Command) {

    'list' {
        $rows = $lib
        if ($WallpaperType) { $rows = @($rows | Where-Object { $_.Type -eq $WallpaperType }) }
        if ($Tag) { $rows = @($rows | Where-Object { $_.Tags -like "*$Tag*" }) }
        Write-Output ("共 {0} 张（库内 {1} 张）" -f @($rows).Count, @($lib).Count)
        $rows | Sort-Object Type, Title |
            Select-Object Id, Type, Title, Tags |
            Format-Table -AutoSize | Out-String -Width 200
    }

    'search' {
        $rows = Resolve-Wallpaper $lib $Query
        if ($WallpaperType) { $rows = @($rows | Where-Object { $_.Type -eq $WallpaperType }) }
        if (@($rows).Count -eq 0) { Write-Output "没找到匹配「$Query」的壁纸。"; break }
        Write-Output ("匹配 {0} 张：" -f @($rows).Count)
        $rows | Select-Object Id, Type, Title, Tags | Format-Table -AutoSize | Out-String -Width 200
    }

    'set' {
        $hits = Resolve-Wallpaper $lib $Query
        if (@($hits).Count -eq 0) { Write-Output "没找到匹配「$Query」的壁纸。先用 search 看一下。"; break }
        if (@($hits).Count -gt 1) {
            Write-Output "匹配到 $(@($hits).Count) 张，请用更精确的标题或 ID 指定其一："
            $hits | Select-Object Id, Type, Title | Format-Table -AutoSize | Out-String -Width 200
            break
        }

        $w = $hits[0]
        if (-not $w.Target -or -not (Test-Path -LiteralPath $w.Target)) {
            Write-Output "壁纸文件缺失：$($w.Target)"
            break
        }

        $targets = Get-TargetMonitors
        Write-Output ("切换到 [{0}] {1}  ({2})" -f $w.Type, $w.Title, $w.Id)
        Write-Output ("  目标文件: {0}" -f $w.Target)
        foreach ($m in $targets) {
            $idx = 0
            if ($m -match '^Monitor(\d+)$') { $idx = [int]$Matches[1] }
            Write-Output ("  -> {0} (index {1})" -f $m, $idx)
            Invoke-WeControl @('-control', 'openWallpaper', '-file', $w.Target, '-monitor', "$idx")
        }
        if (-not $DryRun) { Write-Output "完成。" }
    }

    'current' {
        $cur = Get-CurrentMap
        if ($cur.Count -eq 0) { Write-Output "读不到当前壁纸（config.json 不可读或无记录）。"; break }
        Write-Output "当前壁纸："
        foreach ($m in ($cur.Keys | Sort-Object)) {
            $f = $cur[$m]
            $id = $null
            if ($f -match '431960[\\/](\d+)[\\/]') { $id = $Matches[1] }
            $hit = $null
            if ($id) { $hit = $lib | Where-Object { $_.Id -eq $id } | Select-Object -First 1 }
            $title = if ($hit) { $hit.Title } else { '(库中未找到)' }
            Write-Output ("  {0}: {1}  [{2}]" -f $m, $title, $(if ($id) { $id } else { $f }))
        }
    }

    'monitors' {
        $cur = Get-CurrentMap
        Write-Output "config.json 中记录的显示器："
        $cur.Keys | Sort-Object | ForEach-Object { Write-Output "  $_  -> $($cur[$_])" }
    }

    'pause'  { Invoke-WeControl @('-control', 'pause');  Write-Output '已暂停。' }
    'play'   { Invoke-WeControl @('-control', 'play');   Write-Output '已继续播放。' }
    'stop'   { Invoke-WeControl @('-control', 'stop');   Write-Output '已停止。' }
    'mute'   { Invoke-WeControl @('-control', 'mute');   Write-Output '已静音。' }
    'unmute' { Invoke-WeControl @('-control', 'unmute'); Write-Output '已取消静音。' }
}
