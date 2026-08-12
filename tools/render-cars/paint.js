/**
 * Repaint the kit's palette atlas, in the browser.
 *
 * Ported line for line from the Blender pipeline's `recolor.py`, which this
 * replaced. Kept faithful deliberately: the shipped frames were repainted by
 * that code, and a repaint that drifted would show up as one archetype's paint
 * sitting slightly off the rest of the set rather than as an error.
 *
 * Kenney's Car Kit puts every model on a single material sampling one 512x512
 * palette texture, and each mesh's UVs point at a flat swatch — so a car is
 * repainted by editing the texture, never by touching the material, which would
 * repaint the glass and the tyres with it. Each model ships in its own colour,
 * so `models.json` declares the source hue window per model.
 *
 * SHADING IS PRESERVED RATHER THAN FLATTENED. A band is ~60 shades of one hue;
 * each texel keeps its brightness relative to the band's reference and takes on
 * only the target's hue and saturation. Flattening the band to one colour would
 * throw away the shading the whole render depends on.
 */

export function hexToRgb(value) {
  const v = value.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  ];
}

/** Matches Python's colorsys.rgb_to_hsv: h, s, v all in 0..1. */
export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, max];
}

/** Matches Python's colorsys.hsv_to_rgb. */
export function hsvToRgb(h, s, v) {
  if (s === 0) return [v, v, v];
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/**
 * Repaint one atlas. Returns a canvas plus how many texels were touched.
 *
 * A zero count is always a config error rather than a legitimate no-op — it
 * means the declared band matched nothing in the atlas — so the caller treats
 * it as fatal. That check is the only thing standing between a mis-declared
 * band and nine identical frames that look like the tool worked.
 */
export function repaint(sourceCanvas, band, targetHex) {
  const [th, ts, tv] = rgbToHsv(...hexToRgb(targetHex));
  const referenceV = rgbToHsv(...hexToRgb(band.reference))[2];

  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  let touched = 0;

  for (let i = 0; i < px.length; i += 4) {
    const [h, s, v] = rgbToHsv(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    // Reds wrap around zero, so the window is checked on both sides.
    const inHue =
      (h >= band.hueMin && h <= band.hueMax) || (band.hueMin === 0 && h >= 1 - 0.02);
    // The saturation floor is what separates paint from the shared blue-grey
    // chassis every model carries at ~40% of its surface. Load-bearing.
    if (!inHue || s < band.minSaturation) continue;
    const nv = Math.max(0, Math.min(1, v * (tv / referenceV)));
    const [nr, ng, nb] = hsvToRgb(th, ts, nv);
    px[i] = Math.round(nr * 255);
    px[i + 1] = Math.round(ng * 255);
    px[i + 2] = Math.round(nb * 255);
    touched += 1;
  }

  ctx.putImageData(img, 0, 0);
  return { canvas: out, touched };
}
