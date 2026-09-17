/**
 * Regenerates the PWA/touch icons in `public/` from `public/pwa-192.png`.
 *
 * The apple-touch-icon must be 180x180 (iOS ignores other sizes for the home
 * screen icon). That is not an integer multiple of the 192x192 master, so this
 * uses an area-average resample rather than nearest-neighbour scaling — nearest
 * would alias the logo's anti-aliased edges.
 *
 * Run with: node scripts/generate-pwa-icons.mjs
 *
 * The source icons are fully opaque squares (no baked-in corner radius), which is
 * what iOS/Android want: both platforms apply their own mask, so a pre-rounded
 * icon would end up double-rounded.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));

/** Decodes an 8-bit RGBA (colour type 6) PNG into a flat RGBA buffer. */
function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let pos = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType}): ${file}`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      if (filter === 0) cur[x] = v;
      else if (filter === 1) cur[x] = (v + a) & 0xff;
      else if (filter === 2) cur[x] = (v + b) & 0xff;
      else if (filter === 3) cur[x] = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else {
        throw new Error(`unknown PNG filter ${filter} in ${file}`);
      }
    }
  }
  return { w, h, pixels: out };
}
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

/** Encodes an RGBA image as a PNG (filter type 0 on every scanline). */
function encodePng({ w, h, pixels }, file) {
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
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

/**
 * Builds a fully opaque single-colour RGBA image — all a launch screen needs,
 * since iOS paints the app's own UI over it as soon as the shell is parsed.
 */
function solid(w, h, [r, g, b]) {
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = 255;
  }
  return { w, h, pixels };
}

const master = decodePng(`${PUBLIC}/pwa-192.png`);
console.log(`master: ${master.w}x${master.h}`);

// 180x180 is the size current iPhones request for the home-screen icon. The old
// 192x192 `apple-touch-icon` reference still worked, but only because iOS
// downscaled it itself.
const targets = [{ file: "apple-touch-icon.png", size: 180 }];

for (const { file, size } of targets) {
  encodePng(areaResample(master, size, size), `${PUBLIC}/${file}`);
  const back = decodePng(`${PUBLIC}/${file}`);
  console.log(`${file}: wrote ${back.w}x${back.h}`);
}

// iOS paints a plain white launch screen for an installed PWA unless a matching
// `apple-touch-startup-image` exists, which flashes against this app's dark
// theme. These portrait launch screens are flat `--background`.
//
// Sizes are physical pixels; `cssW`/`cssH` are the points iOS reports via
// `device-width`/`device-height`, so a wrong entry is simply never matched
// (iOS falls back to white, i.e. today's behaviour) rather than breaking.
// `dpr` is the `-webkit-device-pixel-ratio` value.
const SPLASH_BG = [11, 13, 17]; // #0b0d11, the exact sRGB of --background
const SPLASHES = [
  { w: 640, h: 1136, cssW: 320, cssH: 568, dpr: 2 }, // SE (1st gen)
  { w: 750, h: 1334, cssW: 375, cssH: 667, dpr: 2 }, // SE (2nd/3rd), 8, 7, 6s
  { w: 1125, h: 2436, cssW: 375, cssH: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 1170, h: 2532, cssW: 390, cssH: 844, dpr: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  { w: 1179, h: 2556, cssW: 393, cssH: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 1242, h: 2208, cssW: 414, cssH: 736, dpr: 3 }, // 8 Plus
  { w: 828, h: 1792, cssW: 414, cssH: 896, dpr: 2 }, // XR, 11
  { w: 1242, h: 2688, cssW: 414, cssH: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 1284, h: 2778, cssW: 428, cssH: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 1290, h: 2796, cssW: 430, cssH: 932, dpr: 3 }, // 14 Pro Max, 15 Pro Max
];

const mediaFor = (s) =>
  `screen and (device-width: ${s.cssW}px) and (device-height: ${s.cssH}px) ` +
  `and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`;

for (const s of SPLASHES) {
  const file = `splash-${s.w}x${s.h}.png`;
  encodePng(solid(s.w, s.h, SPLASH_BG), `${PUBLIC}/${file}`);
  const back = decodePng(`${PUBLIC}/${file}`);
  if (back.w !== s.w || back.h !== s.h) throw new Error(`bad splash dimensions for ${file}`);
  console.log(`${file}: wrote ${back.w}x${back.h}`);
}

// Printed so the `apple-touch-startup-image` links in src/routes/__root.tsx can
// be kept byte-identical to these files instead of drifting.
console.log("\n--- links for src/routes/__root.tsx ---");
for (const s of SPLASHES) {
  console.log(
    `      { rel: "apple-touch-startup-image", href: "/splash-${s.w}x${s.h}.png", media: "${mediaFor(s)}" },`,
  );
}

console.log("\ndone");
