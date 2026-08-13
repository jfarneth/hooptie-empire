/**
 * Measure where the car actually sits inside each sprite frame.
 *
 *   node tools/measure-sprites/measure.js
 *
 * `RarityTrim` composites spoilers, stripes and underglow over whatever drew the
 * car, and the sprite renderer and the vector renderer do NOT frame a car the
 * same way — measured, they disagree by up to 16% on width, in both directions.
 * So the overlay needs a real footprint per archetype rather than an assumed
 * shared one, and this is where those numbers come from.
 *
 * Uses headless Chromium (already present for Playwright) rather than a Python
 * imaging stack, because the sprites are committed PNGs and a normal checkout
 * has no PIL. Blender is NOT needed: this reads the shipped frames.
 *
 * Paste the output into SPRITE_FOOTPRINTS in src/ui/art/footprint.ts.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SPRITES = path.join(__dirname, '../../src/ui/art/sprites');
// Pearl. Bright enough that no pixel of the soft drop shadow can be mistaken
// for bodywork, which is what makes a plain alpha threshold useless here.
const SWATCH = '08';

async function main() {
  const frames = fs
    .readdirSync(SPRITES)
    .filter((f) => f.endsWith(`_${SWATCH}.png`))
    .sort();

  const imgs = {};
  for (const f of frames) {
    imgs[f.replace(`_${SWATCH}.png`, '')] =
      'data:image/png;base64,' + fs.readFileSync(path.join(SPRITES, f)).toString('base64');
  }

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage();
  const measured = await page.evaluate(async (imgs) => {
    const out = {};
    for (const [name, src] of Object.entries(imgs)) {
      const img = new Image();
      await new Promise((r) => {
        img.onload = r;
        img.src = src;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;

      const solid = (x, y) => {
        const i = (y * c.width + x) * 4;
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        return d[i + 3] > 250 && lum > 70;
      };

      let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (!solid(x, y)) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }

      // Body width at a given fraction of the car's own length. The global bbox
      // is generous — it catches wing mirrors and, at 12 degrees of tilt, the
      // flanks — so anything that has to sit ON the car (a spoiler, a light bar)
      // measures the row it will actually land on.
      const widthAt = (f) => {
        const y = Math.round(y0 + (y1 - y0) * f);
        let a = Infinity, b = -1;
        for (let x = 0; x < c.width; x++) {
          if (!solid(x, y)) continue;
          if (x < a) a = x;
          if (x > b) b = x;
        }
        return b < 0 ? 0 : (b + 1 - a) / c.width;
      };

      out[name] = {
        x: +(x0 / c.width).toFixed(3),
        X: +((x1 + 1) / c.width).toFixed(3),
        y: +(y0 / c.height).toFixed(3),
        Y: +((y1 + 1) / c.height).toFixed(3),
        hood: +widthAt(0.28).toFixed(3),
        mid: +widthAt(0.55).toFixed(3),
        tail: +widthAt(0.85).toFixed(3),
      };
    }
    return out;
  }, imgs);

  await browser.close();

  for (const [name, m] of Object.entries(measured)) {
    console.log(
      `  ${name}: { x: ${m.x}, X: ${m.X}, y: ${m.y}, Y: ${m.Y}, ` +
        `hoodW: ${m.hood}, midW: ${m.mid}, tailW: ${m.tail} },`,
    );
  }
}

main();
