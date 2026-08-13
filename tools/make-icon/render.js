/**
 * Generates the app icon and the splash mark, and rasterises them through
 * headless Chromium. Run from the repo root so `playwright` resolves:
 *
 *   node tools/make-icon/render.js --preview   # candidates into /tmp, look first
 *   node tools/make-icon/render.js             # writes assets/
 *
 * WHY VECTOR AND NOT A SPRITE. The obvious move is to composite one of the
 * rendered PNGs from src/ui/art/sprites. Those ship at 192px wide because that
 * is twice what a car ever occupies on the lot, and an icon needs 1024 — the
 * first cut of this upscaled 2.4x and was visibly soft. The vector renderer has
 * no such ceiling, so the car here is drawn from the same TOP_SHAPES geometry
 * the game uses and comes out sharp at any size.
 *
 * The shape maths below is a deliberate COPY of CarTop.tsx rather than an
 * import: that component pulls in react-native-svg, which will not load in node.
 * Normally duplicating drawing logic would be a bug waiting to happen, but an
 * icon is a frozen PNG the moment it is generated — it is not meant to track
 * later changes to the in-game art, and it must not silently change under a
 * released app. Re-run this by hand if you ever want it to match again.
 *
 * WHY CHROMIUM. It is already required for tools/measure-sprites and for looking
 * at the running game, so this adds nothing a normal checkout does not have.
 *
 * ALPHA: Apple rejects an App Store icon carrying an alpha channel and Chromium
 * writes RGBA regardless of the page being opaque, so every output is
 * recomposited onto an opaque canvas before it is encoded.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { flatten } = require('./flatten');

const ROOT = path.resolve(__dirname, '../..');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// --- copied from the game, see header ------------------------------------
const CAR_BOX_W = 60;
const CAR_BOX_L = 124;
const SHAPE = { w: 44, len: 104, rx: 9, hood: 0.29, roof: [0.43, 0.7], tail: 0.83 };
const PAINT = {
  red: '#b23b3b',
  blue: '#2f5f8a',
  pearl: '#d8d5cd',
  copper: '#c26b3a',
};

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const to2 = (v) => v.toString(16).padStart(2, '0');
  return `#${to2(ch((n >> 16) & 255))}${to2(ch((n >> 8) & 255))}${to2(ch(n & 255))}`;
}
// -------------------------------------------------------------------------

/** The car, in artboard coordinates. Mirrors CarTop's plan view. */
function carSvg(paint) {
  const s = SHAPE;
  const x0 = (CAR_BOX_W - s.w) / 2;
  const y0 = (CAR_BOX_L - s.len) / 2;
  const at = (f) => y0 + s.len * f;
  const across = (f) => x0 + s.w * f;

  const hoodY = at(s.hood);
  const roofA = at(s.roof[0]);
  const roofB = at(s.roof[1]);
  const tailY = at(s.tail);

  // Flatter than the in-game car. On the lot the roof panel is 34px wide and
  // the lighter shade just separates it from the glass; blown up to 1024 the
  // same contrast reads as a second colour, and the gloss stripe on top of it
  // as a white smear. Both are pulled right down here.
  const roofPaint = shade(paint, 0.05);
  const sill = shade(paint, -0.34);
  const glass = '#232c38';

  const wheelW = s.w * 0.14;
  const wheelH = s.len * 0.17;
  const wheel = (x, y) =>
    `<rect x="${x}" y="${y}" width="${wheelW}" height="${wheelH}" rx="${wheelW * 0.42}" fill="#15171c"/>`;

  return `
    ${wheel(x0 - wheelW + 1.5, hoodY - wheelH * 0.75)}
    ${wheel(x0 + s.w - 1.5, hoodY - wheelH * 0.75)}
    ${wheel(x0 - wheelW + 1.5, tailY - wheelH * 1.05)}
    ${wheel(x0 + s.w - 1.5, tailY - wheelH * 1.05)}

    <rect x="${x0}" y="${y0}" width="${s.w}" height="${s.len}" rx="${s.rx}" fill="${paint}"/>

    <rect x="${x0 - 3.2}" y="${hoodY - 0.5}" width="3.6" height="5.4" rx="1.6" fill="${sill}"/>
    <rect x="${x0 + s.w - 0.4}" y="${hoodY - 0.5}" width="3.6" height="5.4" rx="1.6" fill="${sill}"/>

    <path d="M${across(0.2)},${hoodY} L${across(0.8)},${hoodY} L${across(0.85)},${roofA} L${across(0.15)},${roofA} Z" fill="${glass}"/>
    <rect x="${across(0.16)}" y="${roofA}" width="${s.w * 0.68}" height="${roofB - roofA}" rx="3" fill="${roofPaint}"/>
    <path d="M${across(0.18)},${roofB} L${across(0.82)},${roofB} L${across(0.77)},${tailY} L${across(0.23)},${tailY} Z" fill="${glass}"/>

    <rect x="${across(0.23)}" y="${roofA + 2}" width="${s.w * 0.07}" height="${roofB - roofA - 4}" rx="1" fill="#fff" opacity="0.1"/>

    <rect x="${across(0.1)}" y="${y0 + 1.4}" width="${s.w * 0.18}" height="4" rx="1.6" fill="#e8e2c8"/>
    <rect x="${across(0.72)}" y="${y0 + 1.4}" width="${s.w * 0.18}" height="4" rx="1.6" fill="#e8e2c8"/>
    <rect x="${across(0.1)}" y="${y0 + s.len - 5.4}" width="${s.w * 0.18}" height="4" rx="1.6" fill="#8f3630"/>
    <rect x="${across(0.72)}" y="${y0 + s.len - 5.4}" width="${s.w * 0.18}" height="4" rx="1.6" fill="#8f3630"/>
  `;
}

/**
 * @param paint  body colour
 * @param bleed  how much of the plate the car occupies. The icon runs it large;
 *               the splash mark sits smaller because it is drawn on a bare
 *               background with no stalls to fill the frame.
 * @param stalls whether to paint the stall lines.
 */
function plate(paint, { bleed = 0.67, stalls = true, transparent = false } = {}) {
  const S = 1024;
  // Keep every painted element inside the corner mask iOS applies (~22% radius),
  // which is why the stripes are short and pulled well in from the edges.
  const stripe = (cx) => `
    <rect x="${cx - 11}" y="${S * 0.14}" width="22" height="${S * 0.72}" rx="11"
          fill="url(#stripeFade)"/>`;

  const carH = S * bleed;
  const carW = carH * (CAR_BOX_W / CAR_BOX_L);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="tarmac" cx="50%" cy="44%" r="66%">
      <stop offset="0%"   stop-color="#2b3242"/>
      <stop offset="46%"  stop-color="#1e2330"/>
      <stop offset="78%"  stop-color="#141821"/>
      <stop offset="100%" stop-color="#0f121a"/>
    </radialGradient>
    <linearGradient id="stripeFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#f2a63b" stop-opacity="0"/>
      <stop offset="20%"  stop-color="#f2a63b" stop-opacity="0.6"/>
      <stop offset="50%"  stop-color="#f2a63b" stop-opacity="0.72"/>
      <stop offset="85%"  stop-color="#f2a63b" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#f2a63b" stop-opacity="0"/>
    </linearGradient>
    <filter id="drop" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#000" flood-opacity="0.62"/>
    </filter>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3"/>
    </filter>
  </defs>

  ${transparent ? '' : `<rect width="${S}" height="${S}" fill="url(#tarmac)"/>`}

  <g transform="rotate(-8 ${S / 2} ${S / 2})">
    ${stalls ? stripe(S * 0.235) + stripe(S * 0.765) : ''}
  </g>

  ${transparent ? '' : `<rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.05"/>`}

  <g transform="rotate(-8 ${S / 2} ${S / 2})" filter="url(#drop)">
    <g transform="translate(${(S - carW) / 2} ${(S - carH) / 2}) scale(${carW / CAR_BOX_W})">
      ${carSvg(paint)}
    </g>
  </g>
</svg>`;
}

async function raster(page, svg, out, { keepAlpha = false } = {}) {
  await page.setContent(
    `<style>html,body{margin:0;background:${keepAlpha ? 'transparent' : '#0f121a'}}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await page.waitForTimeout(200);
  const buf = await page.screenshot({
    type: 'png',
    omitBackground: keepAlpha,
    clip: { x: 0, y: 0, width: 1024, height: 1024 },
  });

  if (keepAlpha) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('wrote', out, '(alpha kept)');
    return;
  }

  // Re-encode without the alpha channel. This CANNOT be done in the page: a
  // canvas emits RGBA whatever you do, so the channel survives full of 255s and
  // App Store Connect fails on its presence rather than its contents.
  const flat = flatten(buf);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, flat);
  console.log('wrote', out);
}

(async () => {
  const preview = process.argv.includes('--preview');
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  if (preview) {
    for (const [name, hex] of Object.entries(PAINT)) {
      await raster(page, plate(hex), `/tmp/icon-preview/icon-${name}.png`);
    }
  } else {
    // Copper, chosen by looking at all four masked down to 40px rather than at
    // 1024. Blue sinks into the tarmac at small sizes and red goes muddy;
    // copper keeps its silhouette all the way down, and it sits apart in a home
    // screen full of blue and white icons.
    const chosen = PAINT.copper;

    await raster(page, plate(chosen), path.join(ROOT, 'assets/icon.png'));

    // The splash mark is TRANSPARENT, not a small copy of the icon. The plugin
    // centres this image on the flat `backgroundColor` from app.json, so an
    // opaque plate would land as a visibly lighter square floating on the splash
    // colour — the tarmac gradient peaks at #2b3242 against a #101219 ground.
    // Transparent lets the configured background be the background.
    await raster(
      page,
      plate(chosen, { bleed: 0.55, stalls: false, transparent: true }),
      path.join(ROOT, 'assets/splash-icon.png'),
      { keepAlpha: true },
    );

    // Android's adaptive icon is a separate problem: the launcher masks it to
    // whatever shape the device wants and can shift it for parallax, so the
    // foreground needs a transparent background and everything important inside
    // the middle ~66%. That is why it is drawn smaller than the iOS icon and
    // keeps its alpha channel rather than being flattened.
    await raster(
      page,
      plate(chosen, { bleed: 0.44, stalls: false, transparent: true }),
      path.join(ROOT, 'assets/android-icon-foreground.png'),
      { keepAlpha: true },
    );
  }

  await browser.close();
})();
