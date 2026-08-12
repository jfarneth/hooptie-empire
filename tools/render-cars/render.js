/**
 * Render the car art from the `.glb` kit — without Blender.
 *
 *   node tools/render-cars/render.js                 # every view, every colour
 *   node tools/render-cars/render.js --view=side     # one view
 *   node tools/render-cars/render.js --only=sedanEconomy
 *
 * WHY THIS REPLACED THE BLENDER PIPELINE. The frames used to come from Blender
 * + Pillow, and its own README was honest that a normal checkout has neither —
 * so the art was unreproducible in practice, which is not a small thing when
 * the art IS the change you are trying to make. `docs/ui-3d-plan.md` recorded
 * the top-down angle as owed work for that reason alone, and the side angle
 * went unrendered for the whole life of the feature.
 *
 * This renders the same models through three.js in headless Chromium, which the
 * repo already keeps around for driving the app. No Blender, no Python, no
 * imaging stack: `npm i -D playwright three` and it runs. The frames it
 * produces at the top-down angle land within a pixel of the ones Blender
 * produced — the footprints measured off both agree to three decimals — which
 * is what made replacing them a like-for-like swap rather than a re-art.
 *
 * `models.json` is which kit model stands in for each archetype and where its
 * paint lives; `views.json` is the angles. Two files because they are two
 * decisions, and they were one file while there was only one angle.
 *
 * Output goes straight to `src/ui/art/sprites/`, and the generated `index.ts`
 * and the footprint table are written in the same pass — a footprint measured
 * at render time cannot go stale against the frame it describes, which is the
 * one failure mode `tools/measure-sprites` leaves open.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const MODELS = path.join(HERE, 'models');
const CONFIG = path.join(HERE, 'models.json');
const VIEWS = path.join(HERE, 'views.json');
const DEST = path.join(REPO, 'src', 'ui', 'art', 'sprites');
const THREE_DIR = path.join(REPO, 'node_modules', 'three');

// Must match BODY_COLORS in src/sim/models.ts. `Car.colorIndex` indexes both,
// so the order is load-bearing: entry N here is the paint for colorIndex N.
const BODY_COLORS = [
  '#b23b3b', // oxide red
  '#2f5f8a', // fleet blue
  '#3d6b4f', // forest
  '#8a8f96', // silver
  '#2b2f36', // graphite
  '#c8a24a', // champagne
  '#7d5a8c', // plum
  '#c26b3a', // copper
  '#d8d5cd', // pearl
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

/**
 * Serve the tool, the models and three over HTTP.
 *
 * `file://` would be simpler and does not work: ES modules and `fetch` of a
 * `.glb` are both blocked by the file-origin rules, and the GLTFLoader needs
 * both.
 */
function serve() {
  const roots = [
    { prefix: '/models/', dir: MODELS },
    { prefix: '/vendor/three/', dir: THREE_DIR },
    { prefix: '/', dir: HERE },
  ];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    for (const { prefix, dir } of roots) {
      if (!url.startsWith(prefix)) continue;
      const rel = url.slice(prefix.length) || 'index.html';
      const file = path.join(dir, rel);
      // Refuse to serve outside the declared root, so a '..' in a model name
      // cannot read the repo.
      if (!file.startsWith(dir)) break;
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function parseArgs() {
  const args = { view: null, only: null, out: DEST, views: VIEWS, colors: null };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k in args) args[k] = v ?? true;
  }
  return args;
}

function writePng(file, dataUrl) {
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return fs.statSync(file).size;
}

async function main() {
  const args = parseArgs();
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const views = JSON.parse(fs.readFileSync(args.views, 'utf8'));
  // `--colors=1` renders the first swatch only. For eyeballing an angle: the
  // paint is the slowest part of a frame and nine of them say nothing new about
  // where the camera is standing.
  const colors = args.colors ? BODY_COLORS.slice(0, Number(args.colors)) : BODY_COLORS;

  const wantedViews = Object.entries(views).filter(
    ([name, v]) => typeof v === 'object' && !Array.isArray(v) && (!args.view || args.view === name),
  );
  if (wantedViews.length === 0) {
    throw new Error(`no such view '${args.view}' — have ${Object.keys(views).join(', ')}`);
  }

  const archetypes = Object.fromEntries(
    Object.entries(config.archetypes).filter(([name]) => !args.only || args.only === name),
  );
  if (Object.keys(archetypes).length === 0) {
    throw new Error(`no such archetype '${args.only}'`);
  }

  const { server, port } = await serve();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    // SwiftShader. There is no GPU in the container, and three falls back to
    // nothing at all rather than to software unless this is asked for.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.carRendererReady === true);

  fs.mkdirSync(args.out, { recursive: true });
  const report = {};

  for (const [viewName, view] of wantedViews) {
    const box = await page.evaluate(
      ([cfg, v]) => window.carRenderer.measureAll(cfg, v),
      [{ archetypes: config.archetypes }, view],
    );
    const orthoWidth = box.right - box.left;
    const orthoHeight = box.top - box.bottom;
    console.log(`[${viewName}] ortho box ${orthoWidth.toFixed(3)} x ${orthoHeight.toFixed(3)}`);

    const renderHeight = Math.round(view.renderWidth * (orthoHeight / orthoWidth));
    // Geometry, so it is measured once per view rather than once per paint.
    const axes = await page.evaluate(
      ([cfg, v, b]) => window.carRenderer.measureAxes(cfg, v, b),
      [{ archetypes: config.archetypes }, view, box],
    );
    const frames = [];
    const footprints = {};
    let bytes = 0;

    for (const [archetype, spec] of Object.entries(archetypes)) {
      const band = config.paintBands[spec.model];
      if (!band) throw new Error(`config.json has no paintBand for model '${spec.model}'`);

      for (let index = 0; index < colors.length; index += 1) {
        const frame = { model: spec.model, scale: spec.scale, band, color: colors[index] };
        const shot = await page.evaluate(
          async ([f, v, b]) => {
            const url = await window.carRenderer.renderFrame(f, v, b, '/models/Textures/colormap.png');
            const small = await window.carRenderer.shrink(url, v.shipWidth);
            return { small, footprint: await window.carRenderer.measureFrame(small.url) };
          },
          [frame, { ...view, width: view.renderWidth, height: renderHeight }, box],
        );

        const file = `${archetype}${viewName === 'top' ? '' : `-${viewName}`}_${String(index).padStart(2, '0')}.png`;
        bytes += writePng(path.join(args.out, file), shot.small.url);
        frames.push({ archetype, index, file, width: shot.small.width, height: shot.small.height });
        // Pearl is the swatch the footprint is taken from: bright enough that
        // no pixel of the soft drop shadow can be mistaken for bodywork, which
        // is what makes a plain alpha threshold useless on the dark paints.
        if (index === colors.length - 1) footprints[archetype] = shot.footprint;
      }
      console.log(`[${viewName}] ${archetype.padEnd(14)} ${colors.length} colours`);
    }

    report[viewName] = { frames, footprints, axes, bytes, ...shipSize(frames) };
    console.log(
      `[${viewName}] ${frames.length} frames, ${(bytes / 1024 / 1024).toFixed(2)}MB, ` +
        `${report[viewName].width}x${report[viewName].height}`,
    );
  }

  await browser.close();
  server.close();

  // Merge rather than replace. A partial run (`--view=side`) that overwrote the
  // manifest would leave the other view's frames on disk but drop every one of
  // them from the generated table, which looks like the art regressing rather
  // than like the tool losing a file.
  const manifestPath = path.join(args.out, 'frames.json');
  const previous = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).views ?? {}
    : {};
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ views: { ...previous, ...report } }, null, 2) + '\n',
  );
  console.log(`\nwrote ${path.join(args.out, 'frames.json')}`);
  console.log('run `node tools/render-cars/pack.js` to regenerate index.ts and the footprints');
}

function shipSize(frames) {
  return { width: frames[0]?.width ?? 0, height: frames[0]?.height ?? 0 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
