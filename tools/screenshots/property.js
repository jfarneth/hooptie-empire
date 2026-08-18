/**
 * Photograph the deed: the ladder page for the store you are standing on, the
 * purchase confirmation, and the retire panel's rewritten sale.
 *
 *   npx expo export --platform web --output-dir /tmp/web
 *   node tools/screenshots/property.js /tmp/web /tmp/shots [stage]
 *
 * A small used lot by default, with the cash bumped so the deed is affordable —
 * the button has two states and the disabled one is not the one that can read
 * wrong. Same serving, seeding and away-modal rules as reports.js; see there.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');

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
  const [webDir, outDir, stage = 'smallUsed'] = process.argv.slice(2);
  if (!webDir || !outDir) {
    throw new Error('usage: node tools/screenshots/property.js <web-export-dir> <out-dir> [stage]');
  }
  fs.mkdirSync(outDir, { recursive: true });

  const savePath = path.join(outDir, `save-${stage}.json`);
  if (!fs.existsSync(savePath)) {
    execFileSync('npx', ['tsx', 'src/tools/dumpsave.ts', stage, savePath], {
      cwd: REPO,
      stdio: 'inherit',
    });
  }
  const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  const state = save.state ?? save;
  state.lastSeenAt = Date.now();
  // Rich enough to sign the deed, so the button photographs in its live state.
  state.cash = 2_000_000;

  const { server, port } = await serve(path.resolve(webDir));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 420, height: 860 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((payload) => {
    if (!localStorage.getItem('hooptie.save')) localStorage.setItem('hooptie.save', payload);
  }, JSON.stringify(save));

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(2600);

  const shoot = async (name) => {
    const file = path.join(outDir, `${stage}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.basename(file)}`);
  };

  // The sign opens the ladder. It lands on the NEXT store up; page back to the
  // one we are standing on, where the deed block lives.
  await page.getByRole('button', { name: /See every store|see every store/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /previous store/i }).click();
  await page.waitForTimeout(400);
  await shoot('ladder-here');

  await page.getByText(/Buy the property/).click();
  await page.waitForTimeout(400);
  await shoot('deed-confirm');
  await page.getByText('Not yet', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // The retire panel: Office → Retire.
  await page.getByText('Office', { exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByText('Retire', { exact: true }).click();
  await page.waitForTimeout(500);
  await shoot('retire');
  await page.getByText('Sell the empire').click();
  await page.waitForTimeout(400);
  await shoot('retire-confirm');

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
