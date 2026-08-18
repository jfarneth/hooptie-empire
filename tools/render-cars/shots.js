/**
 * Take screenshots of the car art in the running game.
 *
 *   npx expo export --platform web --output-dir /tmp/web
 *   node tools/render-cars/shots.js /tmp/web /tmp/save.json /tmp/shots
 *
 * There is no component renderer in this project and the thing being changed is
 * a picture, so this is the verification that actually applies. CLAUDE.md is
 * emphatic about it and has the scars: the dead feed-slot bonus, the storefront
 * that told a player an overpriced car would move fast, and the franchise
 * showing auction beaters were all invisible to a green suite and obvious in
 * one screenshot.
 *
 * It forces one car of each trim grade onto the lot, because rarity is 90/9/0.9
 * /0.1 and a legendary car will not turn up in a fixture by waiting for it —
 * and the grades are exactly what the overlay has to land correctly on.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
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
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

async function main() {
  const [webDir, savePath, outDir] = process.argv.slice(2);
  // The file is the persisted envelope — { version, state } — not the state.
  const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
  const state = save.state ?? save;

  // The away-summary modal throws up a full-screen backdrop that eats every
  // click on the lot, and it appears whenever the save was last seen over a
  // minute ago. A fixture is always older than that.
  state.lastSeenAt = Date.now();

  // One car per grade, so the overlay is exercised rather than hoped for.
  const grades = ['rare', 'epic', 'legendary'];
  const onLot = state.cars.filter((c) => c.status !== 'sold');
  grades.forEach((g, i) => {
    if (onLot[i]) onLot[i].rarity = g;
  });

  fs.mkdirSync(outDir, { recursive: true });
  const { server, port } = await serve(path.resolve(webDir));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  // Retina, because the deal card draws a car at 220 logical points and the
  // question "is this sharp enough" cannot be answered at 1x — a frame that
  // looks fine in a 1x screenshot is the one a phone upscales three times.
  const page = await browser.newPage({
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: 3,
  });

  // Seed only when the key is absent. addInitScript runs on EVERY navigation,
  // including reload(), so an unconditional write re-stamps the fixture over
  // whatever the game just autosaved.
  await page.addInitScript((payload) => {
    if (!localStorage.getItem('hooptie.save')) localStorage.setItem('hooptie.save', payload);
  }, JSON.stringify(save));

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(2500);

  const shot = async (name) => {
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log(`  ${name}.png`);
  };

  await shot('lot');

  // "Buy" also matches the header text "BUY HERE PAY HERE", so the tab has to
  // be picked off the bottom bar rather than by text alone.
  const tab = (label) => page.getByText(label, { exact: true }).last();
  await tab('Buy').click();
  await page.waitForTimeout(900);
  await shot('feed');

  await tab('Lot').click();
  await page.waitForTimeout(900);
  // Open a car with trim on it. The lot's pressables are the cars.
  const cars = page.getByRole('button', { name: /open this car/i });
  if (await cars.count()) {
    await cars.first().click();
    await page.waitForTimeout(700);
    await shot('sheet');
  }

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
