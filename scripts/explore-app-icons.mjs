#!/usr/bin/env node
/**
 * Design explorer for the Momentum app icon.
 *
 * Renders 6 concepts (A = current "Streak Ascent", B-F = alternates) at
 * 512/192/48/16 px into .icon-preview/, then writes a comparison page that
 * shows every variant at launcher scale and true favicon scale side by side.
 *
 * Run with: node scripts/explore-app-icons.mjs
 * Then open: .icon-preview/variants.html
 *
 * All variants share the mandatory constraints:
 *   - background is exactly #0b0d11 (--background) so the icon melts into
 *     the app chrome and the PWA splash seam stays invisible
 *   - palette comes from the app's chart ramp (mint -> green -> teal -> cyan)
 *   - geometry lives in a 1024-unit design space, rendered by SDF math
 *
 * This tool only writes into .icon-preview/ — it never touches public/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.icon-preview/`;

/* ------------------------------------------------------------------ */
/* Geometry + colour helpers                                           */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed distance to a rounded rectangle (negative = inside). */
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function circleSDF(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** Exact inside/outside test for a triangle. */
function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
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

/** Normalizes atan2 output into the window [start, start + 2pi). */
function normAngle(a, start) {
  while (a < start) a += Math.PI * 2;
  return a;
}

/* ------------------------------------------------------------------ */
/* Shared palette + background                                         */
/* ------------------------------------------------------------------ */

const BG = [11, 13, 17]; // #0b0d11 — must stay in sync with --background

const RAMP = [
  [0.0, [198, 250, 222]],
  [0.4, [80, 232, 142]],
  [0.75, [26, 190, 140]],
  [1.0, [16, 148, 158]],
];

function ramp(t) {
  const x = clamp(t, 0, 1);
  for (let i = 1; i < RAMP.length; i++) {
    const p1 = RAMP[i][0];
    const c1 = RAMP[i][1];
    const p0 = RAMP[i - 1][0];
    const c0 = RAMP[i - 1][1];
    if (x <= p1) return mix(c0, c1, (x - p0) / (p1 - p0));
  }
  return RAMP[RAMP.length - 1][1];
}

/** Shared background: exact #0b0d11 base + radial glow + top sheen + vignette. */
function makeBackground(gx, gy, glowRadius, glowStrength) {
  return (px, py) => {
    let r = BG[0];
    let g = BG[1];
    let b = BG[2];
    const d = Math.hypot(px - gx, py - gy) / glowRadius;
    const glow = Math.max(0, 1 - d) ** 2 * glowStrength;
    r += (80 - r) * glow;
    g += (232 - g) * glow;
    b += (142 - b) * glow;
    const sheen = Math.max(0, 1 - py / 900) * 0.05;
    r += sheen * 40;
    g += sheen * 48;
    b += sheen * 60;
    const dc = Math.hypot(px - 512, py - 512) / 724;
    const vig = 1 - 0.16 * smoothstep(0.55, 1.0, dc);
    return [r * vig, g * vig, b * vig];
  };
}

const DIM = mix(BG, [150, 170, 185], 0.26); // faint outline tone
const LIGHT = [200, 248, 216]; // pale mint for rings/highlights
const ARROW_LIGHT = [220, 255, 232];

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

const VARIANTS = {
  "a-streak-ascent": {
    label: "A · Streak Ascent — current",
    blurb: "7 weekday bars climbing the chart ramp, ringed winner + arrowhead.",
    bg: makeBackground(545, 470, 620, 0.2),
    ops: () => {
      const G0 = { x: 232, y: 792 };
      const G1 = { x: 832, y: 266 };
      const len = Math.hypot(G1.x - G0.x, G1.y - G0.y);
      const ux = (G1.x - G0.x) / len;
      const uy = (G1.y - G0.y) / len;
      const grad = (x, y) => ramp(((x - G0.x) * ux + (y - G0.y) * uy) / len);
      const bars = [
        { cx: 266, top: 616 },
        { cx: 348, top: 554 },
        { cx: 430, top: 574 },
        { cx: 512, top: 496 },
        { cx: 594, top: 516 },
        { cx: 676, top: 424 },
      ].map((b) => ({ ...b, bottom: 712, hw: 34, r: 20 }));
      const HI = { cx: 758, top: 330, bottom: 726, hw: 38, r: 22 };
      const hicy = (HI.top + HI.bottom) / 2;
      const hihh = (HI.bottom - HI.top) / 2;
      return [
        ...bars.map((b) => ({
          hit: (x, y) =>
            roundedRectSDF(x, y, b.cx, (b.top + b.bottom) / 2, b.hw, (b.bottom - b.top) / 2, b.r) <= 0,
          color: grad,
        })),
        {
          hit: (x, y) => roundedRectSDF(x, y, HI.cx, hicy, HI.hw, hihh, HI.r) <= 0,
          color: (x, y) => mix(grad(x, y), [255, 255, 255], 0.1),
        },
        {
          hit: (x, y) =>
            roundedRectSDF(x, y, HI.cx, hicy, HI.hw + 4, hihh + 4, HI.r + 4) <= 0 &&
            roundedRectSDF(x, y, HI.cx, hicy, HI.hw, hihh, HI.r) > 0,
          color: () => LIGHT,
        },
        {
          hit: (x, y) => pointInTriangle(x, y, 758, 246, 692, 338, 824, 338),
          color: () => ARROW_LIGHT,
        },
      ];
    },
  },

  "b-ring-momentum": {
    label: "B · Ring Momentum",
    blurb: "82%-closed progress ring, arrow tip at the arc end, chevron core.",
    bg: makeBackground(512, 512, 660, 0.16),
    ops: () => {
      const cx = 512;
      const cy = 532;
      const R = 300;
      const half = 48;
      const sweep = Math.PI * 2 * 0.82;
      const start = -Math.PI / 2;
      const ae = start + sweep;
      const ex = cx + R * Math.cos(ae);
      const ey = cy + R * Math.sin(ae);
      const dirx = -Math.sin(ae);
      const diry = Math.cos(ae);
      const nx = Math.cos(ae);
      const ny = Math.sin(ae);
      return [
        {
          hit: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - R) <= half,
          color: () => DIM,
        },
        {
          hit: (x, y) => {
            const dx = x - cx;
            const dy = y - cy;
            if (Math.abs(Math.hypot(dx, dy) - R) > half) return false;
            return normAngle(Math.atan2(dy, dx), start) <= start + sweep;
          },
          color: (x, y) => ramp((normAngle(Math.atan2(y - cy, x - cx), start) - start) / sweep),
        },
        {
          hit: (x, y) =>
            pointInTriangle(
              x,
              y,
              ex + dirx * 150,
              ey + diry * 150,
              ex + nx * 112,
              ey + ny * 112,
              ex - nx * 112,
              ey - ny * 112,
            ),
          color: () => ARROW_LIGHT,
        },
        {
          hit: (x, y) => strokeLineSDF(x, y, [[382, 622], [512, 492], [642, 622]]) <= 34,
          color: () => LIGHT,
        },
      ];
    },
  },

  "c-momentum-bolt": {
    label: "C · Momentum Bolt",
    blurb: "Angular bolt with gradient body and bright core stroke.",
    bg: makeBackground(512, 480, 640, 0.18),
    ops: () => {
      const pts = [[636, 176], [392, 528], [560, 528], [388, 848]];
      return [
        {
          hit: (x, y) => strokeLineSDF(x, y, pts) <= 78,
          color: (x, y) => ramp(clamp((y - 176) / (848 - 176), 0, 1)),
        },
        {
          hit: (x, y) => strokeLineSDF(x, y, pts) <= 44,
          color: () => [214, 255, 228],
        },
      ];
    },
  },

  "d-rising-dots": {
    label: "D · Rising Dots",
    blurb: "7-day trajectory arcing upward, ringed 'today' dot + arrow.",
    bg: makeBackground(560, 480, 640, 0.18),
    ops: () => {
      const dots = [];
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        dots.push({
          x: 250 + i * 88,
          y: 690 - Math.pow(t, 1.6) * 360,
          r: 30 + i * 5,
          t,
        });
      }
      const last = dots[dots.length - 1];
      const linePts = dots.map((d) => [d.x, d.y]);
      return [
        {
          hit: (x, y) => strokeLineSDF(x, y, linePts) <= 8,
          color: (x, y) => ramp((x - 250) / 528),
        },
        ...dots.map((d) => ({
          hit: (x, y) => circleSDF(x, y, d.x, d.y, d.r) <= 0,
          color: () => ramp(d.t),
        })),
        {
          hit: (x, y) =>
            circleSDF(x, y, last.x, last.y, last.r + 10) <= 0 &&
            circleSDF(x, y, last.x, last.y, last.r) > 0,
          color: () => LIGHT,
        },
        {
          hit: (x, y) => pointInTriangle(x, y, last.x, 172, last.x - 42, 252, last.x + 42, 252),
          color: () => ARROW_LIGHT,
        },
      ];
    },
  },

  "e-momentum-m": {
    label: "E · Momentum M",
    blurb: "Geometric M monogram in the chart gradient with a light core.",
    bg: makeBackground(512, 500, 650, 0.17),
    ops: () => {
      const pts = [[300, 725], [300, 295], [512, 585], [724, 295], [724, 725]];
      const grad = (x) => ramp((x - 300) / (724 - 300));
      return [
        {
          hit: (x, y) => strokeLineSDF(x, y, pts) <= 75,
          color: grad,
        },
        {
          hit: (x, y) => strokeLineSDF(x, y, pts) <= 42,
          color: (x, y) => mix(grad(x), [255, 255, 255], 0.22),
        },
      ];
    },
  },

  "f-streak-grid": {
    label: "F · Streak Grid",
    blurb: "3x3 week heatmap ascending to a ringed 'today' cell.",
    bg: makeBackground(700, 700, 720, 0.2),
    ops: () => {
      const centers = [256, 512, 768];
      const values = [
        [0.15, 0.3, 0.45],
        [0.35, 0.55, 0.75],
        [0.6, 0.85, 1.0],
      ];
      const cells = [];
      for (let ry = 0; ry < 3; ry++) {
        for (let rx = 0; rx < 3; rx++) {
          cells.push({ cx: centers[rx], cy: centers[ry], v: values[ry][rx] });
        }
      }
      const last = cells[cells.length - 1];
      const fill = (v) => mix([16, 148, 158], [140, 255, 180], v);
      return [
        // Faint outlines for all 9 cells.
        ...cells.map((c) => ({
          hit: (x, y) =>
            roundedRectSDF(x, y, c.cx, c.cy, 100, 100, 24) <= 0 &&
            roundedRectSDF(x, y, c.cx, c.cy, 92, 92, 18) > 0,
          color: () => DIM,
        })),
        // Bottom-anchored fills.
        ...cells.map((c) => ({
          hit: (x, y) =>
            Math.abs(x - c.cx) <= 98 &&
            y >= c.cy + 98 - 196 * c.v &&
            y <= c.cy + 98,
          color: () => fill(c.v),
        })),
        // Ring around the completed "today" cell.
        {
          hit: (x, y) =>
            roundedRectSDF(x, y, last.cx, last.cy, 116, 116, 30) <= 0 &&
            roundedRectSDF(x, y, last.cx, last.cy, 104, 104, 26) > 0,
          color: () => LIGHT,
        },
      ];
    },
  },
};

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

const DESIGN = 1024;
const SIZES = [512, 192, 48, 16];

function renderIcon(variant, size) {
  const ops = variant.ops();
  const bg = variant.bg;
  const scale = size / DESIGN;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const dy = (y + 0.5) / scale;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / scale;
      let c = bg(dx, dy);
      // Later ops paint over earlier ones.
      for (const op of ops) {
        if (op.hit(dx, dy)) c = op.color(dx, dy);
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

/** Area-average resample — correct for arbitrary (non-integer) factors. */
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

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
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

/* ------------------------------------------------------------------ */
/* Preview page                                                        */
/* ------------------------------------------------------------------ */

function writePreviewPage(variantFiles) {
  const sections = Object.keys(VARIANTS)
    .map((key) => {
      const v = VARIANTS[key];
      const f = variantFiles[key];
      return `  <section class="v">
    <h2>${v.label}</h2>
    <p>${v.blurb}</p>
    <div class="row">
      <figure><img src="${f[512]}" width="128" height="128" style="border-radius:28.6px" alt=""><figcaption>launcher</figcaption></figure>
      <figure><img src="${f[192]}" width="96" height="96" style="border-radius:50%" alt=""><figcaption>circle mask</figcaption></figure>
      <figure><img src="${f[48]}" width="48" height="48" style="border-radius:10px" alt=""><figcaption>48</figcaption></figure>
      <figure><img src="${f[16]}" width="16" height="16" style="border-radius:3px" alt=""><figcaption>16</figcaption></figure>
      <figure><img src="${f[16]}" width="32" height="32" style="border-radius:6px;image-rendering:pixelated" alt=""><figcaption>16 @2x</figcaption></figure>
      <figure><img src="${f[512]}" width="256" height="256" alt=""><figcaption>512 master</figcaption></figure>
    </div>
  </section>`;
    })
    .join("\n");

  writeFileSync(
    `${OUT}variants.html`,
    `<!doctype html>
<html><head><meta charset="utf-8">
<title>Momentum icon design exploration</title>
<style>
  body{font-family:system-ui;margin:2rem;background:#0b0d11;color:#e8ecef}
  h1{font-weight:700}
  h2{margin:0;font-weight:600}
  .v{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid #1c2129}
  .v p{margin:.3rem 0 1rem;color:#9aa3ad;font-size:.9rem}
  .row{display:flex;gap:2rem;align-items:flex-end;flex-wrap:wrap}
  figure{margin:0;text-align:center;font-size:.72rem;color:#8a939d}
  figure img{display:block;margin:0 auto .4rem;background:#0b0d11}
  .hint{color:#6f7883;font-size:.85rem}
</style></head><body>
<h1>Momentum icon — design exploration</h1>
<p class="hint">All variants share the app background (#0b0d11) and the chart-ramp palette.
Pick by launcher silhouette and 16&nbsp;px legibility — that's where icons live or die.</p>
${sections}
<p class="hint" style="margin-top:3rem">Tell the agent which letter wins (or what to mix from two).</p>
</body></html>`,
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });

const variantFiles = {};
for (const [key, variant] of Object.entries(VARIANTS)) {
  variantFiles[key] = {};
  const master = renderIcon(variant, DESIGN);
  for (const size of SIZES) {
    const file = `v-${key}-${size}.png`;
    writeFileSync(`${OUT}${file}`, pngBytes(size === DESIGN ? master : areaResample(master, size, size)));
    variantFiles[key][size] = file;
  }
  console.log(`${key}: rendered ${SIZES.join("/")}`);
}

writePreviewPage(variantFiles);
console.log(`\npreview: open .icon-preview/variants.html in a browser`);
console.log("done");
