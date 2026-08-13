/**
 * Photograph the Reports tab and the inventory ageing report.
 *
 *   npx expo export --platform web --output-dir /tmp/web
 *   node tools/screenshots/reports.js /tmp/web /tmp/shots [stage]
 *
 * The ageing report is a table of every car on the lot, and the only things
 * that can go wrong with it are things a test cannot see: a row that wraps to
 * four lines, a cost trail that runs off the edge on a franchise car, a sort
 * chip row that reflows badly. Every mistake in the lot art was found by looking
 * at a screenshot and none by a test — same rule applies here.
 *
 * A small used lot is the default because it is the first store where all three
 * cost lines are non-zero at once: it recons, it sits long enough to accrue
 * floorplan, and it finances, so cars come back. Pass a stage id to shoot a
 * different rung.
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
    throw new Error('usage: node tools/screenshots/reports.js <web-export-dir> <out-dir> [stage]');
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
  // The away-summary modal throws a full-screen backdrop over everything
  // whenever the save was last seen more than a minute ago, and a fixture
  // always was.
  (save.state ?? save).lastSeenAt = Date.now();

  const { server, port } = await serve(path.resolve(webDir));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const context = await browser.newContext({
    viewport: { width: 420, height: 860 },
    deviceScaleFactor: 2,
  });
  // Seed only when absent — addInitScript runs on EVERY navigation, so an
  // unconditional write re-stamps the fixture over whatever the game just saved.
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

  // The bottom nav is Lot / Buy / Notes / Office. Exact text, because "Buy"
  // also matches the header "BUY HERE PAY HERE".
  await page.getByText('Office', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByText('Reports', { exact: true }).click();
  await page.waitForTimeout(500);
  await shoot('index');

  // The weekly books, and its departmental tiles — the other half of the
  // Reports index, and the part that only looks right on a store running all
  // four lines at once.
  await page.getByText('Weekly books', { exact: true }).click();
  await page.waitForTimeout(700);
  await shoot('books');
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  await shoot('books-lines');
  await page.getByText('This week', { exact: true }).click();
  await page.waitForTimeout(400);
  await shoot('books-lines-live');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement?.blur?.());

  await page.getByText('Inventory ageing', { exact: true }).click();
  await page.waitForTimeout(700);
  await shoot('ageing');

  // Every sort, because the row is what reflows and the widest number in each
  // column changes with the ordering.
  for (const label of ['Most tied up', 'Thinnest first', 'Costliest to keep']) {
    await page.getByText(label, { exact: true }).click();
    await page.waitForTimeout(400);
    await shoot(`ageing-${label.split(' ')[0].toLowerCase()}`);
  }

  // Scrolled down, so the footnote and the bottom of the table get looked at
  // too — a table that reads fine at the top is where a long row hides.
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  await shoot('ageing-scrolled');

  // And a row opens the car, which is the thing that makes this a place you can
  // act rather than a place you read.
  await page.getByText('Oldest first', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(300);
  // By the row's accessibility label, not by its text: "Your money in it" on
  // the Reports index behind the modal matches a text filter for "In it" and
  // Playwright then spends thirty seconds failing to click a covered element.
  await page.getByRole('button', { name: /on the lot$/ }).first().click();
  await page.waitForTimeout(700);
  await shoot('car-from-report');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // Drop focus before the next shot. A clicked row keeps the browser's focus
  // ring, which is a white outline sitting exactly where the buyer border goes
  // — on a phone it does not exist at all, and in a screenshot it looks like
  // the feature is painting the wrong colour.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(200);

  // A row with a buyer on it takes the offer's colour and opens the DEAL. The
  // game is ticking, so this is a matter of waiting for one to walk up rather
  // than of arranging one — a walk-up's patience is 45 seconds and the desk
  // takes it after 30, so the window is real but it comes around often.
  const buyerRow = page.getByRole('button', { name: /Open the deal\.$/ }).first();
  try {
    await buyerRow.waitFor({ timeout: 90_000 });
    await shoot('ageing-buyer');
    // And the row itself, which is usually below the fold — that is the whole
    // reason the pills are pinned above the table rather than left to the
    // border alone.
    // A wheel, not scrollIntoViewIfNeeded: the sheet's scroller is a React
    // Native ScrollView and Playwright decides the row is already "in view".
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(400);
    await shoot('ageing-buyer-row');
    await buyerRow.click();
    await page.waitForTimeout(800);
    await shoot('deal-from-report');
  } catch {
    console.log('  (no walk-up inside 90s — buyer rows not photographed)');
  }

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
