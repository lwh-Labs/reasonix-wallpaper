#!/usr/bin/env node
/**
 * 从 Wallpaper Engine 的 scene.pkg 里提取一张高清图层，用作背景。
 *
 * 背景：scene 类型壁纸是 3D 场景，网页渲染不了，只能拿 preview.gif/jpg 当背景 ——
 * 但那些通常只有 256x256 ~ 1024x1024，铺到 2K 屏上必糊。
 * 而 scene.pkg（PKGV 格式）里嵌着原始分辨率的 PNG 图层，动辄 3840 宽。
 *
 * 策略：扫出所有内嵌 PNG，挑「面积最大 + 宽高比在 1.25~4.5 之间」的那张。
 * 排除 1:1 是为了避开材质贴图（石头/木纹那种方块图）。
 *
 * 用法：node extract-hero.mjs <scene.pkg> <输出目录>
 * 输出：JSON 一行，成功时含 { ok:true, w, h, out, ... }
 */
import fs from "node:fs";
import path from "node:path";

const [, , pkgPath, outDir] = process.argv;
if (!pkgPath || !outDir) {
  console.log(JSON.stringify({ ok: false, reason: "usage: extract-hero.mjs <pkg> <outDir>" }));
  process.exit(0);
}

let buf;
try {
  buf = fs.readFileSync(pkgPath);
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: "read failed: " + e.message }));
  process.exit(0);
}

// PKGV 头校验：08 00 00 00 "PKGV"
if (buf.length < 12 || buf.toString("latin1", 4, 8) !== "PKGV") {
  console.log(JSON.stringify({ ok: false, reason: "not a PKGV package" }));
  process.exit(0);
}

const START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const END = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

const found = [];
let pos = 0;
while (true) {
  const s = buf.indexOf(START, pos);
  if (s < 0) break;
  const e = buf.indexOf(END, s);
  if (e < 0) break;
  const end = e + END.length;
  if (s + 26 > buf.length) break;
  const w = buf.readUInt32BE(s + 16);
  const h = buf.readUInt32BE(s + 20);
  // 只收合理的尺寸，避免把损坏块当成图
  if (w > 64 && h > 64 && w <= 16384 && h <= 16384) {
    found.push({ s, end, w, h, bytes: end - s, ratio: w / h, area: w * h });
  }
  pos = end;
}

if (!found.length) {
  console.log(JSON.stringify({ ok: false, reason: "no PNG inside", size: buf.length }));
  process.exit(0);
}

// 候选：足够大、宽高比像画面（不像方形材质）
const cands = found
  .filter((f) => f.w >= 1600 && f.h >= 500 && f.ratio >= 1.25 && f.ratio <= 4.5)
  .sort((a, b) => b.area - a.area);

if (!cands.length) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: "no landscape layer",
      total: found.length,
      largest: found.sort((a, b) => b.area - a.area).slice(0, 3).map((f) => `${f.w}x${f.h}`),
    }),
  );
  process.exit(0);
}

const pick = cands[0];
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "hero.png");
fs.writeFileSync(out, buf.subarray(pick.s, pick.end));

console.log(
  JSON.stringify({
    ok: true,
    w: pick.w,
    h: pick.h,
    bytes: pick.bytes,
    out,
    totalPng: found.length,
    candidates: cands.length,
  }),
);
