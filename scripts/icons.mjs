// Draws the app mark and writes every raster the web app, the PWA and the Play
// shell need from it. Run it with `npm run icons` after editing anything in the
// GEOMETRY section; the outputs are committed, so this is a regeneration step
// and not part of the build.
//
// Why a script and not a folder of exported PNGs: the mark ends up in about
// thirty files at ten sizes across three masks (rounded, circular, full-bleed),
// and hand-exporting that set is how an icon quietly drifts out of step with
// itself — an old glass on the Play launcher, a new one in the browser tab.
// Here there is one definition and everything else is derived.
//
// The design is Art Deco read straight: symmetry about a vertical axis, a
// stepped base, and a sunburst fan rising behind the rim — the motif that was
// over every speakeasy door and hotel lobby in the 1920s. Colours come from the
// bar photograph the app sits on, so the icon and the interface agree.

import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => {
  const f = resolve(ROOT, p);
  mkdirSync(dirname(f), { recursive: true });
  return f;
};

// ── GEOMETRY ───────────────────────────────────────────────────────────────
// Everything is drawn in a 100×100 box. Keep these in step with the C palette
// in src/App.jsx: INK is C.ink, BRASS is C.brass.
const INK = '#17100a';   // the ground — the darkest wood in the photograph
const BRASS = '#d6b46a'; // the glass
const DIM = '#8a6a24';   // the fan, held back so the glass stays the subject

// The fan: wedges opening upward from a point on the rim. An odd count keeps a
// wedge on the centre line, which is what makes it read as symmetric rather
// than as a spray. `duty` is how much of each slot is filled, so the gaps
// between wedges are ground colour and survive being scaled down to 16px.
function fan(cx, cy, r, n, duty, fill) {
  const step = 180 / n;
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  };
  return Array.from({ length: n }, (_, i) => {
    const pad = (step * (1 - duty)) / 2;
    return `<path d="M${cx} ${cy} L${pt(180 + step * i + pad)} L${pt(180 + step * (i + 1) - pad)} Z" fill="${fill}"/>`;
  }).join('');
}

// The mark itself, without any ground. The bowl carries no interior detail: at
// tab size banding and a chevroned rim both silt up, and the fan is already
// carrying the period. The base is two bars rather than one — the step is the
// cheapest Deco signal there is, and it costs four points of height.
//
// The bowl is a truncated V, not a triangle, and the stem runs up inside it.
// A full triangle meeting a narrower stem pinches to a point at the join, and
// the two then read as separate shapes touching rather than one glass; ending
// the bowl on the stem's own width makes the stem a continuation of it. The 2
// units of overlap are there so no rasterizer can open a hairline at the seam.
const MARK = [
  fan(50, 36, 22, 7, 0.66, DIM),
  `<path d="M21 36 L79 36 L54.5 62 L45.5 62 Z" fill="${BRASS}"/>`,
  `<rect x="45.5" y="60" width="9" height="19" fill="${BRASS}"/>`,
  `<rect x="35" y="79" width="30" height="4.5" fill="${BRASS}"/>`,
  `<rect x="28" y="84" width="44" height="5.5" rx="1" fill="${BRASS}"/>`,
].join('\n  ');

// Drawn extent of MARK, used to centre it when a mask needs it shrunk.
const BOX = { x: 21, y: 14, w: 58, h: 75.5 };
const CX = BOX.x + BOX.w / 2;
const CY = BOX.y + BOX.h / 2;

// `scale` shrinks the mark about the centre of the box so it clears whatever
// the platform crops. Android guarantees only the middle 72 of 108dp on an
// adaptive icon, and a maskable PWA icon only the middle 80% — a mark drawn to
// the edges loses its base to both.
function icon({ ground = 'rounded', scale = 1, size = 100 } = {}) {
  const grounds = {
    rounded: `<rect width="100" height="100" rx="22" fill="${INK}"/>`,
    square: `<rect width="100" height="100" fill="${INK}"/>`,
    circle: `<circle cx="50" cy="50" r="50" fill="${INK}"/>`,
    none: '',
  };
  const body =
    scale === 1
      ? MARK
      : `<g transform="translate(50 50) scale(${scale}) translate(${-CX} ${-CY})">${MARK}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${grounds[ground]}
  ${body}
</svg>`;
}

const png = (svg, px) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: px }, font: { loadSystemFonts: false } })
    .render()
    .asPng();

// The same render written as a truecolour PNG — 8-bit RGB, no alpha channel.
// resvg only ever emits RGBA, and a store icon carrying an alpha channel is one
// of the commonest submission rejections: App Store Connect refuses it outright
// and Play's own rounding mask can bleed through wherever it is not fully
// opaque. The store grounds are opaque in every pixel, so the channel is dead
// weight; this drops it rather than trusting a reviewer not to look.
function pngOpaque(svg, px) {
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: px },
    font: { loadSystemFonts: false },
  }).render();
  const { width: w, height: h, pixels } = img;

  // Scanlines, each prefixed with filter type 0 (None), alpha dropped.
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = row + 1 + x * 3;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour, no alpha
  // bytes 10-12 stay 0: deflate, adaptive filtering, no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A splash is the mark small and centred on the ground, at whatever aspect
// ratio the density bucket asks for — not the icon stretched to fill it.
function splash(w, h) {
  const s = Math.min(w, h) * 0.32;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${INK}"/>
  <svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 100 100">${MARK}</svg>
</svg>`;
}

// ICO carrying PNG payloads — supported everywhere that still asks for a .ico,
// and it saves hand-rolling a BMP encoder for three small sizes.
function ico(sizes) {
  const images = sizes.map((s) => png(icon({ ground: 'rounded' }), s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); // 0 means 256
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...images]);
}

// ── OUTPUTS ────────────────────────────────────────────────────────────────
const written = [];
const write = (path, data) => {
  writeFileSync(out(path), data);
  written.push(path);
};

// The SVG is what the browser tab actually loads; the PNGs are fallbacks and
// store assets. Two copies because public/ is served as-is and src/assets/ is
// what the bundler and the store listings draw from.
const master = icon({ ground: 'rounded' });
write('public/favicon.svg', master);
write('src/assets/favicon.svg', master);
write('public/icon-192.png', png(master, 192));
write('public/icon-512.png', png(master, 512));
write('src/assets/favicon.png', png(master, 512));
write('src/assets/favicon.ico', ico([16, 32, 48]));

// Maskable: full-bleed ground, mark pulled in so a circular or squircle crop
// cannot clip the base.
write('public/icon-maskable-512.png', png(icon({ ground: 'square', scale: 0.78 }), 512));

// Android. `ic_launcher_foreground` is the adaptive layer and carries no
// ground of its own — the colour behind it is values/ic_launcher_background.xml,
// which is set to INK. The two flat variants are for launchers predating
// adaptive icons.
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];
for (const [d, legacy, adaptive] of DENSITIES) {
  const base = `android/app/src/main/res/mipmap-${d}`;
  write(`${base}/ic_launcher.png`, png(icon({ ground: 'rounded' }), legacy));
  write(`${base}/ic_launcher_round.png`, png(icon({ ground: 'circle', scale: 0.86 }), legacy));
  write(`${base}/ic_launcher_foreground.png`, png(icon({ ground: 'none', scale: 0.62 }), adaptive));
}

// Store listings. Every storefront applies its own corner mask to what you
// upload, so these are full-bleed squares — a pre-rounded upload gets rounded a
// second time and the ground shows through the corners as a dark rind.
//
// Two files because the two specs contradict each other: Play Console asks for
// "512 px, 32-bit PNG (with alpha)", while App Store Connect rejects any icon
// carrying an alpha channel at all. Neither will take the other's file without
// argument, so each gets its own, named for where it goes.
write('store/play-icon-512.png', png(icon({ ground: 'square' }), 512));
write('store/app-store-icon-1024.png', pngOpaque(icon({ ground: 'square' }), 1024));

// Splash screens, per orientation and density, at the sizes Capacitor's
// template shipped. drawable/ (no qualifier) is the fallback bucket.
const SPLASH = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
];
for (const [dir, w, h] of SPLASH) {
  write(`android/app/src/main/res/${dir}/splash.png`, png(splash(w, h), w));
}

console.log(`wrote ${written.length} files:\n  ${written.join('\n  ')}`);
