/**
 * Re-encodes an 8-bit RGBA PNG as 8-bit RGB, dropping the alpha channel.
 *
 * This exists because **Apple rejects an App Store icon that carries an alpha
 * channel**, and there is no way to get one out of a browser: `<canvas>` always
 * encodes PNG as RGBA even when the drawing context is created with
 * `{alpha: false}` and every pixel is opaque. The channel is there, full of
 * 255s, and App Store Connect fails the upload on its presence rather than on
 * its contents.
 *
 * Pure node with only `zlib` on purpose. The alternative is ImageMagick or
 * sharp, neither of which is installed here and both of which would be a new
 * dependency for one build step that runs by hand a handful of times.
 *
 * Only handles what Chromium actually emits: 8-bit, colour type 6, no
 * interlacing. It throws on anything else rather than writing a corrupt file.
 */
const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunks(buf) {
  const out = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Undo the per-scanline filter. See PNG spec §9.2. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const type = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      switch (type) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error('unknown PNG filter ' + type);
      }
      cur[i] = v & 255;
    }
  }
  return out;
}

/**
 * @param buf   RGBA PNG bytes
 * @param bg    what to composite semi-transparent pixels onto, as [r,g,b]
 * @returns     RGB PNG bytes, with no alpha channel at all
 */
function flatten(buf, bg = [15, 18, 26]) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');

  const cs = chunks(buf);
  const ihdr = cs.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('no IHDR');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8];
  const color = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (color === 2) return buf; // already RGB, nothing to do
  if (depth !== 8 || color !== 6 || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${depth} color=${color} interlace=${interlace}`);
  }

  const idat = zlib.inflateSync(
    Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)),
  );
  const px = unfilter(idat, width, height, 4);

  // Rebuild as RGB with filter type 0 on every scanline. Filtering exists to
  // help compression, and an icon is written once — simple beats small here.
  const stride = width * 3;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    rows[o] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = px[i + 3] / 255;
      for (let ch = 0; ch < 3; ch++) {
        rows[o + 1 + x * 3 + ch] = Math.round(px[i + ch] * a + bg[ch] * (1 - a));
      }
    }
  }

  const newIhdr = Buffer.from(ihdr.data);
  newIhdr[9] = 2; // colour type 2 = truecolour, no alpha

  return Buffer.concat([
    SIG,
    chunk('IHDR', newIhdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { flatten };
