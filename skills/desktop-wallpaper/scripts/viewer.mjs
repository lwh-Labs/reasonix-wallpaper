#!/usr/bin/env node
/**
 * Wallpaper Engine 可视化选择器 —— 本地 HTTP 服务
 *
 * 零依赖，只监听 127.0.0.1。职责：
 *   GET  /              卡片网格界面
 *   GET  /api/list      壁纸库 + 当前播放状态
 *   POST /api/apply     切换壁纸 { id, monitor? }
 *   GET  /thumb/<id>    缩略图（preview.gif / preview.jpg）
 *
 * 用法：node server.mjs [--no-open]
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 本机环境 ----------------------------------------------------------
const WE_ROOT = 'E:/Steam/steamapps/common/wallpaper_engine';
const WS_ROOT = 'E:/Steam/steamapps/workshop/content/431960';
const EXE     = path.join(WE_ROOT, 'wallpaper64.exe');
const CONFIG  = path.join(WE_ROOT, 'config.json');
const INDEX   = path.join(__dirname, 'viewer.html');

const HOST     = '127.0.0.1';
const PORT     = Number(process.env.WALLPAPER_PORT || 47821);
const THROTTLE = 900;   // WE 连续 openWallpaper 会崩，必须节流
const CACHE_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// ---- 壁纸库 ------------------------------------------------------------
let library = { at: 0, items: [] };

async function scanLibrary(force = false) {
  if (!force && Date.now() - library.at < CACHE_MS && library.items.length) {
    return library.items;
  }
  const items = [];
  let dirents = [];
  try {
    dirents = await fsp.readdir(WS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const dir = path.join(WS_ROOT, d.name);
    let meta;
    try {
      meta = JSON.parse(stripBom(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')));
    } catch {
      continue;
    }
    const type = String(meta.type || '').toLowerCase();
    const file = String(meta.file || '');
    // 官方 CLI：scene 传 project.json；video/web 传项目里声明的入口文件
    let target;
    if (type === 'scene') target = path.join(dir, 'project.json');
    else if (file) target = path.join(dir, file);
    else target = path.join(dir, 'project.json');

    items.push({
      id: d.name,
      title: String(meta.title || d.name),
      type: type || 'unknown',
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      target,
      preview: meta.preview ? path.join(dir, String(meta.preview)) : null,
    });
  }

  items.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, 'zh'));
  library = { at: Date.now(), items };
  return items;
}

// ---- 当前播放状态 ------------------------------------------------------
async function readCurrent() {
  try {
    const cfg = JSON.parse(stripBom(await fsp.readFile(CONFIG, 'utf8')));
    // config.json 顶层：一个以 Steam 用户名命名的键 + "?installdirectory"
    const userKey = Object.keys(cfg).find((k) => !k.startsWith('?'));
    if (!userKey) return {};
    const sel = cfg[userKey]?.general?.wallpaperconfig?.selectedwallpapers ?? {};
    const out = {};
    for (const [mon, v] of Object.entries(sel)) {
      const f = String(v?.file || '');
      const m = f.match(/431960[\\/](\d+)[\\/]/);
      out[mon] = m ? m[1] : null;
    }
    return out;
  } catch {
    return {};
  }
}

// ---- 切换 --------------------------------------------------------------
function runExe(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(EXE, args, { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`wallpaper64.exe 退出码 ${code}`)),
    );
  });
}

async function applyWallpaper(item, monitorParam) {
  const cur = await readCurrent();
  let idxs;

  if (monitorParam === null || monitorParam === undefined || monitorParam === 'all') {
    const mons = Object.keys(cur).filter((k) => /^Monitor\d+$/.test(k));
    idxs = mons.length ? mons.map((k) => Number(k.replace('Monitor', ''))) : [0];
  } else {
    const n = Number(monitorParam);
    if (!Number.isInteger(n) || n < 0) throw new Error('monitor 参数无效');
    idxs = [n];
  }

  for (const i of idxs) {
    await runExe(['-control', 'openWallpaper', '-file', item.target, '-monitor', String(i)]);
    await sleep(THROTTLE);
  }
  return idxs;
}

// ---- HTTP 工具 ---------------------------------------------------------
function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function sendFile(res, file, mime, cacheControl = 'no-store') {
  try {
    const st = await fsp.stat(file);
    res.writeHead(200, {
      'content-type': mime,
      'content-length': st.size,
      'cache-control': cacheControl,
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const PREVIEW_MIME = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

// ---- 路由 --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return await sendFile(res, INDEX, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/list') {
      const [items, current] = await Promise.all([scanLibrary(), readCurrent()]);
      return sendJson(res, 200, { ok: true, items, current });
    }

    if (req.method === 'POST' && url.pathname === '/api/apply') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      }
      const id = String(payload.id || '');
      const items = await scanLibrary();
      const item = items.find((i) => i.id === id);
      if (!item) return sendJson(res, 404, { ok: false, error: `未知的壁纸 ID: ${id}` });

      const monitors = await applyWallpaper(item, payload.monitor);
      await sleep(500); // 等 WE 异步写回 config.json
      const current = await readCurrent();
      return sendJson(res, 200, { ok: true, id, title: item.title, monitors, current });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/thumb/')) {
      const id = decodeURIComponent(url.pathname.slice('/thumb/'.length));
      const items = await scanLibrary();
      const item = items.find((i) => i.id === id);
      if (!item?.preview) {
        res.writeHead(404);
        return res.end('no preview');
      }
      const mime = PREVIEW_MIME[path.extname(item.preview).toLowerCase()] || 'application/octet-stream';
      return await sendFile(res, item.preview, mime, 'public, max-age=86400');
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个：set WALLPAPER_PORT=47822 后再运行。`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`Wallpaper Engine 选择器已启动: ${url}`);
  console.log('按 Ctrl+C 关闭。');
  if (!process.argv.includes('--no-open') && process.platform === 'win32') {
    // start 的第一个参数是窗口标题，留空占位
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});
