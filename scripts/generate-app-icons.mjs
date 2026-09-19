#!/usr/bin/env node
/**
 * Generates the Momentum app icon set in `public/`.
 *
 * Design — "Momentum Bolt":
 *   An angular lightning bolt drawn as a thick round-capped polyline, its body
 *   filled with the app's chart gradient (oklch chart-1..3: green -> teal,
 *   rendered here in sRGB) and a pale core stroke for energy. Background is
 *   the app's exact `--background` (#0b0d11) with a soft radial glow, so the
 *   icon melts into the PWA chrome.
 *
 * Outputs:
 *   pwa-512.png / pwa-192.png      fully opaque square masters (no baked-in
 *                                  corner radius — stores apply their own mask)
 *   pwa-maskable-512/192.png       art inset into a transparent safe-zone tile
 *   favicon.ico                    16/32/48 PNG frames re-rendered fresh,
 *                                  merged with any larger legacy frames
 *   apple-touch-icon.png + splash-*.png
 *                                  delegated to scripts/generate-pwa-icons.mjs
 *                                  (run automatically at the end)
 *
 * Run with: node scripts/generate-app-icons.mjs
 *
 * Also writes .icon-preview/index.html so the result can be eyeballed in a
 * browser at every size and corner-mask shape.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = `${ROOT}public/`;
const PREVIEW_DIR = `${ROOT}.icon-preview/`;

/* ------------------------------------------------------------------ */
/* Colour + geometry helpers                                           */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Linear blend of two [r,g,b] triples. */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Distance to a polyline with round caps and joins. */
function strokeLineSDF(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) t = clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
    best = Math.min(best, Math.hypot(px - (ax + abx * t), py - (ay + aby * t)));
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Palette (sRGB; matches the oklch tokens in src/styles.css)          */
/* ------------------------------------------------------------------ */

// --background: oklch(0.16 0.008 260) — must match the value documented in
// src/routes/__root.tsx and public/manifest.webmanifest.
const BG_BASE = [11, 13, 17]; // #0b0d11
const GLOW = [46, 204, 113];

// chart-1 (oklch 0.87 0.21 128) -> chart-3 (oklch 0.66 0.13 200) ramp.
const RAMP_STOPS = [
  [0.0, [198, 250, 222]],
  [0.4, [80, 232, 142]],
  [0.75, [26, 190, 140]],
  [1.0, [16, 148, 158]],
];

function ramp(t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < RAMP_STOPS.length; i++) {
    const [p1, c1] = RAMP_STOPS[i];
    const [p0, c0] = RAMP_STOPS[i - 1];
    if (x <= p1) return mix(c0, c1, (x - p0) / (p1 - p0));
  }
  return RAMP_STOPS[RAMP_STOPS.length - 1][1];
}

/* ------------------------------------------------------------------ */
/* The icon, drawn in a 1024x1024 design space                         */
/* ------------------------------------------------------------------ */

const DESIGN = 1024;

// The bolt: top-right tail -> mid-left elbow -> mid-right step -> bottom tip.
const BOLT_PTS = [
  [636, 176],
  [392, 528],
  [560, 528],
  [388, 848],
];

// Vertical gradient window across the bolt's extent.
const BOLT_TOP = 176;
const BOLT_BOTTOM = 848;

function boltGradient(_px, py) {
  return ramp(clamp((py - BOLT_TOP) / (BOLT_BOTTOM - BOLT_TOP), 0, 1));
}

function background(px, py) {
  let [r, g, b] = BG_BASE;

  // Radial green glow behind the chart.
  const d = Math.hypot(px - 512, py - 480) / 640;
  const glow = Math.max(0, 1 - d) ** 2 * 0.18;
  r += (GLOW[0] - r) * glow;
  g += (GLOW[1] - g) * glow;
  b += (GLOW[2] - b) * glow;

  // Faint cool sheen along the top edge.
  const sheen = Math.max(0, 1 - py / 900) * 0.05;
  r += sheen * 40;
  g += sheen * 48;
  b += sheen * 60;

  // Corner vignette so the tile reads as a lit surface, not flat black.
  const dc = Math.hypot(px - 512, py - 512) / 724;
  const vig = 1 - 0.16 * smoothstep(0.55, 1.0, dc);
  return [r * vig, g * vig, b * vig];
}

/** Renders the design at `size`x`size` into an RGBA buffer. */
function renderIcon(size) {
  const scale = size / DESIGN;
  const px = new Buffer.alloc(size * size * 4);
  // Paint order matters: gradient body -> bright core.
  const shapes = [
    {
      hit: (x, y) => strokeLineSDF(x, y, BOLT_PTS) <= 78,
      color: (x, y) => boltGradient(x, y),
    },
    {
      hit: (x, y) => strokeLineSDF(x, y, BOLT_PTS) <= 44,
      color: () => [214, 255, 228],
    },
  ];

  for (let y = 0; y < size; y++) {
    const dy = (y + 0.5) / scale;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / scale;
      let c = background(dx, dy);
      for (const s of shapes) {
        if (s.hit(dx, dy)) c = s.color(dx, dy);
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(clamp(c[0], 0, 255));
      px[o + 1] = Math.round(clamp(c[1], 0, 255));
      px[o + 2] = Math.round(clamp(c[2], 0, 255));
      px[o + 3] = 255;
    }
  }
  return { w: size, h: size, pixels: px };
}

/* ------------------------------------------------------------------ */
/* PNG encode + area resample (kept in sync with generate-pwa-icons)   */
/* ------------------------------------------------------------------ */

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngBytes({ w, h, pixels }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodePng(img, file) {
  writeFileSync(file, pngBytes(img));
}

/** Area-average resample — correct for arbitrary (non-integer) scale factors. */
function areaResample(img, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sx = img.w / dw;
  const sy = img.h / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * sy;
    const y1 = (dy + 1) * sy;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * sx;
      const x1 = (dx + 1) * sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const cy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wgt = (Math.min(x + 1, x1) - Math.max(x, x0)) * cy;
          const i = (y * img.w + x) * 4;
          r += img.pixels[i] * wgt;
          g += img.pixels[i + 1] * wgt;
          b += img.pixels[i + 2] * wgt;
          a += img.pixels[i + 3] * wgt;
          wsum += wgt;
        }
      }
      const o = (dy * dw + dx) * 4;
      out[o] = Math.round(r / wsum);
      out[o + 1] = Math.round(g / wsum);
      out[o + 2] = Math.round(b / wsum);
      out[o + 3] = Math.round(a / wsum);
    }
  }
  return { w: dw, h: dh, pixels: out };
}

/** Centers `inner` on a `size`x`size` fully transparent tile. */
function insetOnTransparent(inner, size) {
  const out = Buffer.alloc(size * size * 4);
  const off = Math.round((size - inner.w) / 2);
  for (let y = 0; y < inner.h; y++) {
    const src = y * inner.w * 4;
    const dst = ((y + off) * size + off) * 4;
    inner.pixels.copy(out, dst, src, src + inner.w * 4);
  }
  return { w: size, h: size, pixels: out };
}

/* ------------------------------------------------------------------ */
/* favicon.ico: every frame (16/32/48/256) rendered fresh from the      */
/* master so the artwork is consistent at every size.                   */
/* ------------------------------------------------------------------ */

function buildIco(frames, file) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const f of frames) {
    const e = Buffer.alloc(16);
    e[0] = f.w >= 256 ? 0 : f.w;
    e[1] = f.h >= 256 ? 0 : f.h;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp (PNG frames are self-describing)
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += f.data.length;
  }
  writeFileSync(file, Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]));
}

/* ------------------------------------------------------------------ */
/* Preview page                                                        */
/* ------------------------------------------------------------------ */

function writePreview() {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const tile = (src, size, round) =>
    `<figure><img src="../public/${src}" width="${size}" height="${size}" ` +
    `style="border-radius:${round}px" alt="${src}"><figcaption>${src}</figcaption></figure>`;

  writeFileSync(
    `${PREVIEW_DIR}index.html`,
    `<!doctype html><html><head><meta charset="utf-8">
<title>Momentum icon preview</title><style>
  body{font-family:system-ui;margin:2rem;background:#0b0d11;color:#eee}
  h2{margin-top:2.5rem;font-weight:600}
  .row{display:flex;gap:2rem;align-items:flex-end;flex-wrap:wrap}
  figure{margin:0;text-align:center;font-size:.75rem;color:#9aa3ad}
  figure img{display:block;margin:0 auto .4rem;image-rendering:auto}
  .light{background:#f4f5f7;display:inline-block;padding:12px;border-radius:12px}
  .sq{border-radius:0}.r12{border-radius:12px}.half{border-radius:50%}
  .squoosh{border-radius:22.37%}
</style></head><body>
<h1>Momentum — "Momentum Bolt" icon set</h1>
<h2>Store / PWA masters (opaque square, stores apply their own mask)</h2>
<div class="row">
  ${tile("pwa-512.png", 256, 0)}
  ${tile("pwa-192.png", 128, 0)}
</div>
<h2>As a launcher would mask it</h2>
<div class="row">
  <div class="light">${tile("pwa-512.png", 96, 0).replace('"0"', '"22.37%"').replace("sq", "squoosh")}</div>
  ${tile("pwa-512.png", 96, 51.2)}
</div>
<h2>Maskable (safe-zone inset on transparent)</h2>
<div class="row">
  ${tile("pwa-maskable-512.png", 256, 51.2)}
  ${tile("pwa-maskable-192.png", 96, 19.2)}
</div>
<h2>Favicon frames (from favicon.ico renders)</h2>
<div class="row">
  ${tile("icon-48.png", 48, 8)}
  ${tile("icon-32.png", 32, 6)}
  ${tile("icon-16.png", 16, 3)}
</div>
<h2>apple-touch-icon (iOS, 180x180)</h2>
<div class="row">${tile("apple-touch-icon.png", 180, 40)}</div>
</body></html>`,
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

console.log("Rendering Momentum icon (Momentum Bolt)…");
const master = renderIcon(1024);

const std512 = areaResample(master, 512, 512);
const std192 = areaResample(master, 192, 192);
encodePng(std512, `${PUBLIC}pwa-512.png`);
encodePng(std192, `${PUBLIC}pwa-192.png`);
console.log("pwa-512.png: wrote 512x512");
console.log("pwa-192.png: wrote 192x192");

// Maskable: art inset into the 80% safe zone on a transparent tile, per the
// existing convention (manifest background_color shows through the edges).
encodePng(insetOnTransparent(areaResample(std512, 410, 410), 512), `${PUBLIC}pwa-maskable-512.png`);
encodePng(insetOnTransparent(areaResample(std192, 154, 154), 192), `${PUBLIC}pwa-maskable-192.png`);
console.log("pwa-maskable-512.png / pwa-maskable-192.png: wrote");

// favicon.ico — every frame rendered fresh from the 1024px master so the
// artwork is consistent at every size (16/32/48 for tabs, 256 for OS shortcuts).
const ICO_SIZES = [48, 32, 16, 256];
const fresh = ICO_SIZES.map((s) => {
  if (s <= 48) encodePng(areaResample(master, s, s), `${PUBLIC}icon-${s}.png`);
  return { w: s, h: s, data: pngBytes(areaResample(master, s, s)) };
});
buildIco(fresh, `${PUBLIC}favicon.ico`);
console.log(`favicon.ico: fresh frames (${ICO_SIZES.slice().reverse().join("/")}), written`);

// Delegate apple-touch-icon + iOS splash regeneration to the legacy script.
execFileSync(process.execPath, [`${ROOT}scripts/generate-pwa-icons.mjs`], { stdio: "inherit" });

writePreview();
console.log(`\npreview: open ${PREVIEW_DIR}index.html in a browser`);
console.log("done");
