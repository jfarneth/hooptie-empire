/**
 * Photograph the Lot screen at every stage of the ladder.
 *
 *   npx expo export --platform web --output-dir /tmp/web
 *   node tools/screenshots/lots.js /tmp/web /tmp/shots
 *
 * The six stores are the ladder's whole argument — moving up has to LOOK like
 * something — and there is no way to review that from a test. Playing to a
 * premium franchise takes 300 game hours, so each stage is dumped through
 * `src/tools/dumpsave.ts`, which buys the store outright and lets the real
 * engine stock the lot.
 *
 * Everything CLAUDE.md warns about when driving this app is handled here rather
 * than rediscovered: the away-summary backdrop, the init-script re-stamp, and
 * the fact that a premium franchise pans sideways and has to be scrolled to the
 * middle before it is worth looking at.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');

/** The ladder, in order, with the caption each shot is filed under. */
const STAGES = [
  ['curbstone', 'Curbstone'],
  ['smallUsed', 'Small used lot'],
  ['largeUsed', 'Large used lot'],
  ['lowCostFranchise', 'Low-cost franchise'],
  ['midsizeFranchise', 'Midsize franchise'],
  ['premiumFranchise', 'Premium franchise'],
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (!fs.existsSync(file)) file = path.join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })),
  );
}

async function main() {
  const [webDir, outDir] = process.argv.slice(2);
  if (!webDir || !outDir) {
    throw new Error('usage: node tools/screenshots/lots.js <web-export-dir> <out-dir>');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const saves = path.join(outDir, 'saves');
  fs.mkdirSync(saves, { recursive: true });

  const { server, port } = await serve(path.resolve(webDir));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });

  for (const [stage, caption] of STAGES) {
    const savePath = path.join(saves, `${stage}.json`);
    if (!fs.existsSync(savePath)) {
      execFileSync('npx', ['tsx', 'src/tools/dumpsave.ts', stage, savePath], {
        cwd: REPO,
        stdio: 'inherit',
      });
    }
    const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    // The away-summary modal throws a full-screen backdrop over the lot whenever
    // the save was last seen more than a minute ago, and a fixture always was.
    (save.state ?? save).lastSeenAt = Date.now();

    // A fresh context per stage: localStorage is per origin, and the whole
    // point is that each shot starts from its own save.
    const context = await browser.newContext({
      viewport: { width: 420, height: 860 },
      deviceScaleFactor: 2,
    });
    // Seed only when absent — addInitScript runs on EVERY navigation, so an
    // unconditional write re-stamps the fixture over whatever the game just
    // autosaved.
    await context.addInitScript((payload) => {
      if (!localStorage.getItem('hooptie.save')) localStorage.setItem('hooptie.save', payload);
    }, JSON.stringify(save));

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForTimeout(2600);

    // A premium franchise is eleven rows deep and does not fit a phone, so the
    // scene reports `panned` and lives in a horizontal scroller. Photographing
    // it at rest shows the left-hand fence.
    // Biased right of centre, not centred: the yaw swings the building's far
    // end off to the right, so a centred scroll photographs the fence.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        if (el.scrollWidth > el.clientWidth + 40) {
          el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.72;
        }
      }
    });
    await page.waitForTimeout(500);

    const file = path.join(outDir, `${stage}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.basename(file).padEnd(24)} ${caption}`);
    await context.close();
  }

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
