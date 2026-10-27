# Reasonix Wallpaper

Bring your **Wallpaper Engine** library into **Reasonix** as a live app background.

Bundled with a small utility for switching your Windows desktop wallpaper.

```
┌─────────────────────────────────────────────────────────┐
│  ▍sidebar (frosted)      │  chat area (wallpaper shows)  │
│  ▍                       │                               │
│  ▍ Default workspace     │   your wallpaper lives here   │
│  ▍   Greeting            │   text stays legible via      │
│  ▍                       │   text-shadow                 │
│                          │  ┌─────────────────────────┐  │
│                          │  │ composer (frosted)      │  │
│                          │  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Why this exists

Reasonix plugins can only contribute skills / commands / hooks / MCP servers — there is no UI mount point. The built-in theme pack system accepts static images only (`png/jpg/jpeg/webp`), so it can't carry the animated wallpapers in your Wallpaper Engine library.

So this plugin takes the **`index.html` injection** route: it appends a pure-DOM wallpaper panel to the page. No React dependency, no changes to existing logic. If anything breaks, worst case the background doesn't show — Reasonix itself is unaffected.

## Features

| | |
|---|---|
| **App background** | Reads your WE library; supports static layers, animated GIFs, and video |
| **Floating panel** | Bottom-right button or `Ctrl+Alt+W`, thumbnail grid, click a card to switch instantly |
| **Adjustable opacity** | Slider 20%–100%, live, persisted |
| **Hi-res extraction** | Pulls original-resolution layers out of `scene.pkg` — ~20× sharper than WE's own 256×256 previews |
| **Desktop wallpaper** | Bonus: switch your Windows desktop wallpaper via CLI or a thumbnail page |

## Requirements

- Windows
- Reasonix desktop (verified on `v1.39.7`)
- Wallpaper Engine (Steam)
- Node.js (`extract-hero.mjs` and the picker page need it)

Paths default to `E:\Steam\steamapps\common\wallpaper_engine`. If yours differs, change `$WorkshopRoot` at the top of `scripts/install.ps1`.

## Install

```powershell
# 1) install the plugin straight from GitHub
reasonix plugin install https://github.com/lwh-Labs/reasonix-wallpaper --yes

# 2) inject the background layer
& "<Reasonix home>\plugins\reasonix-wallpaper\skills\reasonix-background\scripts\install.ps1" -Apply

# 3) restart Reasonix (or press Ctrl+R)
```

A wallpaper button appears in the bottom-right corner.

## Usage

- **Change background** — click the bottom-right button, then any card
- **Adjust opacity** — slider at the bottom of the panel; drag left for a more visible wallpaper
- **Quick toggle** — `Ctrl + Alt + W`
- **Turn off** — "关闭壁纸引擎" at the bottom of the panel; `Ctrl+Alt+W` brings it back

## Uninstall

```powershell
& "...\scripts\install.ps1" -Restore
```

Restores `index.html`, removes the `__rxwallpaper` directory (including the junction), and cleans up any leftover service or startup entry.

**Note**: the uninstall deliberately detaches the junction *before* deleting the directory, so it never recurses into your wallpaper library.

---

## How it works (the gotchas)

This is where the real time went. Read this before changing anything.

### 1. `file://` doesn't work

The obvious first attempt: `<img src="file:///E:/Steam/.../preview.jpg">`.

Result: **every thumbnail broke, clicking a card did nothing.**

Reasonix doesn't load its page over `file://`. It registers a custom protocol:

```js
protocol.registerSchemesAsPrivileged([{ scheme: ur, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }])
protocol.handle(ur, async e => { const t = ca(e.url, r.distRoot, la); ... })
```

All assets are served from `distRoot` (`app\resources\app`). A `file:///E:/...` URL is cross-protocol and gets blocked by Chromium — silently, with no error.

### 2. The fix: an NTFS junction

Create a junction at `__rxwallpaper\ws` pointing at the WE library:

```
app\resources\app\__rxwallpaper\ws  ⟶  E:\Steam\steamapps\workshop\content\431960
```

A junction is a filesystem-level construct, not a shortcut. To any program — including Chromium's path validation — it looks like a real subdirectory of the app folder. So:

- `./__rxwallpaper/ws/3305590289/xxx.mp4` is same-origin and loads fine ✓
- Nothing is copied; even a 505 MB video works ✓

**Why not a symlink**: creating symlinks on Windows requires admin rights (`A required privilege is not held by the client`). Junctions don't.

### 3. Why the local HTTP server was abandoned

An earlier version served images from `127.0.0.1:47822` with `/t/<id>` and `/m/<id>` routes, full Range support, CORS, and path-traversal guards.

The problem was **the process wouldn't stay alive**:

- Child processes started via `Start-Process` get reaped when the PowerShell session ends
- `Win32_Process.Create` (WMI) survives across sessions, but proved unstable after Reasonix restarts

A service that dies is worse than a junction. The junction needs no process, no port, no maintenance.

### 4. Why scene wallpapers looked blurry

WE's `preview.gif` / `preview.jpg` are **thumbnails**, not the actual frame:

| Wallpaper | Preview resolution |
|---|---|
| Dome 4k | 256×256 |
| The Dark Night | 755×755 |
| Sakura | 1024×1024 |

Stretched to a 2K screen that's a 10× upscale. Nothing to do with CSS.

The real pixels are inside `scene.pkg` — a `PKGV0019` container (~29 MB) full of original-resolution PNG layers:

```
Header: 08 00 00 00  50 4B 47 56 30 30 31 39
                     P  K  G  V  0  0  1  9
```

`extract-hero.mjs` scans for embedded PNGs (bracketed by `89 50 4E 47` … `49 45 4E 44`), reads the IHDR for dimensions, and picks the layer with **the largest area whose aspect ratio falls between 1.25 and 4.5**.

The aspect-ratio filter exists to skip square material textures (stone, wood grain) that aren't a scene on their own.

Measured results:

```
Dome 4k  → 3840×1184 (Earth from orbit)   [thumbnail was 256×256]
Sakura   → 3507×2200
```

Converted to 2560-wide JPEGs, cached per id in `hero/`, so subsequent runs are instant. 22 of 31 scene wallpapers yield a usable layer.

### 5. Blur in the wrong place destroys the wallpaper

The easiest mistake to make. First attempt applied `backdrop-filter: blur(24px)` to `#root` — "soften the background so text stays readable."

Result: **the entire wallpaper collapsed into a muddy smear.**

The correct approach is layered:

```css
/* frosted glass on floating surfaces */
.sidebar, .composer-card, .workspace-panel {
  backdrop-filter: blur(22px) saturate(1.3);
}

/* content areas stay fully transparent */
.chat-pane, .chat-transcript, .chat-surface {
  background: transparent !important;
}

/* readability via shadow, not by darkening the backdrop */
body {
  text-shadow: 0 1px 2px rgba(0,0,0,.6);
}
```

The class names were extracted from Reasonix's own CSS bundle (`styles-*.css`, 851 KB, 3,930 class names).

### 6. Opacity and wallpaper visibility multiply

```
visible = (1 − backdrop scrim) × (1 − panel opacity)
```

A panel's "translucent" layer **is black** — 50% opacity isn't "half the wallpaper showing", it's "half a layer of black paint".

Push both hard and the wallpaper vanishes. Current defaults: panel base 0.42, scrim 0.06–0.18.

### 7. Two platform traps

**`-notlike '?*'` — the `?` is a wildcard**, matching any non-empty string. It silently filtered out every user key in WE's `config.json`, so the current wallpaper could never be read. Use `.StartsWith('?')`.

**`.ps1` files need a UTF-8 BOM.** Windows PowerShell 5.1 reads BOM-less scripts as GBK, and Chinese comments blow up the parser with baffling "missing terminator" errors.

---

## Known limitations

- Injection breaks when Reasonix upgrades to a new version directory — just re-run `-Apply` (the script auto-detects the newest `versions\v*`)
- A handful of scene wallpapers have no suitable large layer in their pkg and fall back to the low-res preview
- Hi-res layers are often wide (e.g. 2560×789); `object-fit: cover` crops the sides, so framing differs from the live 3D render
- Very large video wallpapers (500 MB+) use noticeable memory
- Only verified on Reasonix `v1.39.7` / Windows. On other versions the frosted-glass selectors may stop matching (functionality is unaffected)

## Layout

```
reasonix-wallpaper/
  reasonix-plugin.json
  skills/
    reasonix-background/          Reasonix app background
      SKILL.md
      assets/
        rx-wallpaper.css          injected styles (glass / panel / var overrides)
        rx-wallpaper.js           injected logic (panel / switching / slider)
      scripts/
        install.ps1               inject / restore / status
        extract-hero.mjs          pull hi-res layers out of scene.pkg
    desktop-wallpaper/            Windows desktop wallpaper
      SKILL.md
      scripts/
        wallpaper.ps1              CLI: list / search / set / current / pause…
        viewer.mjs                 thumbnail grid page (Node, zero deps)
        viewer.html
        start-viewer.cmd
```

## License

MIT
