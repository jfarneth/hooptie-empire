/**
 * Photograph the empire: the keep-or-walk confirmation, a manager-run store's
 * page (green chip, sell-off button), and the resume button.
 *
 *   npx expo export --platform web --output-dir /tmp/web
 *   node tools/screenshots/empire.js /tmp/web /tmp/shots
 *
 * A midsize-franchise save with the small lot kept and its property owned, so
 * one run of pages shows all three states at once: blue-kept (small lot),
 * gray (everything untouched), and the store being stood at. Same serving,
 * seeding and away-modal rules as reports.js.
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
  const [webDir, outDir] = process.argv.slice(2);
  if (!webDir || !outDir) {
    throw new Error('usage: node tools/screenshots/empire.js <web-export-dir> <out-dir>');
  }
  fs.mkdirSync(outDir, { recursive: true });

  const savePath = path.join(outDir, 'save-empire.json');
  execFileSync('npx', ['tsx', 'tools/screenshots/empiresave.ts', savePath], {
    cwd: REPO,
    stdio: 'inherit',
  });
  const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  (save.state ?? save).lastSeenAt = Date.now();

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
    const file = path.join(outDir, `empire-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  ${path.basename(file)}`);
  };

  await page.getByRole('button', { name: /See every store|see every store/ }).click();
  await page.waitForTimeout(700);

  // The ladder opens on the next store up (premium). Page down to the kept
  // small lot: premium → okabe(here) → halvorsen → big lot → small lot.
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /previous store/i }).click();
    await page.waitForTimeout(300);
  }
  await shoot('kept-store');

  // Back up to the store being stood at, and open the move confirmation for
  // the next rung, where the keep choice lives.
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /next store/i }).click();
    await page.waitForTimeout(250);
  }
  await page.getByText(/Take on the/).click();
  await page.waitForTimeout(400);
  await shoot('keep-choice');

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
