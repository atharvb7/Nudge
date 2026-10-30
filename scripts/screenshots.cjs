/* Regenerates the README screenshots in docs/images/.
 *   npm run build -w extension && npm run build -w dashboard
 *   (optional) backend on :8000 so steps come from the backend instead of offline cards
 *   node scripts/screenshots.cjs
 * Uses Playwright's Chromium with reduced motion so nothing is caught mid-animation. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright not found — npm i --no-save playwright && npx playwright install chromium');
}

const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const DIST = path.join(ROOT, 'extension', 'dist');
const DASH_PORT = 3007; // not 3000, so the dashboard shows its sample-data mode
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>DBMS_Assignment_3.pdf</title></head>
<body style="margin:0;font-family:Georgia,serif;background:#e9e9e9">
<div style="max-width:620px;margin:32px auto;background:#fff;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.15);min-height:900px">
<h1 style="font-size:24px;margin:0 0 4px">Database Management Systems</h1>
<p style="color:#555;margin:0 0 28px">Assignment 3 · Normalisation</p>
<p><b>Q1.</b> Given the relation R(StudentID, Name, CourseID, CourseName, Instructor, Grade) and the functional dependencies below, decompose R into 3NF.</p>
<p style="color:#444">StudentID → Name<br>CourseID → CourseName, Instructor<br>StudentID, CourseID → Grade</p>
<p><b>Q2.</b> Is your decomposition lossless? Justify using the chase test.</p>
<p><b>Q3.</b> Write SQL to create the decomposed tables with primary and foreign keys.</p>
</div></body></html>`;

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((_q, r) => {
      r.setHeader('Content-Type', 'text/html; charset=utf-8');
      r.end(PAGE);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function shot(page, name, opts = {}) {
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, name + '.png'), animations: 'disabled', ...opts });
  console.log('✓', name);
}

async function extensionShots() {
  const server = await serve();
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-shots-')), {
    headless: true,
    channel: 'chromium',
    viewport: { width: 400, height: 760 },
    reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const task = await ctx.newPage();
    await task.setViewportSize({ width: 900, height: 620 });
    await task.goto(`http://127.0.0.1:${server.address().port}/`);
    await sleep(1200);
    for (const p of ctx.pages()) if (p.url().includes('onboarding.html')) await p.close();

    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.getByText('Hi, I’m Nudge.').waitFor();
    const tab = panel.getByRole('radio', { name: /DBMS_Assignment/ });
    if (await tab.count()) await tab.first().click();
    await panel.getByRole('button', { name: /continue/i }).first().click();
    await shot(panel, 'panel-onboarding');
    await panel.getByRole('radio', { name: /Warm & casual/ }).click();
    await panel.getByRole('button', { name: 'Continue' }).click();
    await panel.getByRole('radio', { name: /Buttons only/ }).click();
    await panel.getByRole('button', { name: 'All set' }).click();
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    await shot(panel, 'panel-home');

    await panel.getByLabel(/What is it|Or type it/).fill('DBMS assignment');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 40000 });
    await shot(panel, 'panel-step');

    await panel.getByRole('button', { name: /^Done/ }).click();
    await panel.getByText(/Did this help\?/).waitFor();
    await shot(panel, 'panel-celebrate');
    await panel.getByRole('button', { name: 'Yes, it helped' }).click();
    await panel.getByRole('button', { name: 'Body-double mode' }).click();
    await panel.getByRole('timer').waitFor();
    await sleep(4000); // let the ring move a little
    await shot(panel, 'panel-body-double');
    await panel.getByRole('button', { name: 'Stop for now' }).click();
    await panel.getByRole('button', { name: '5 min', exact: true }).waitFor();
    await shot(panel, 'panel-rest');
    await panel.getByRole('button', { name: '5 min', exact: true }).click();
    await panel.getByRole('button', { name: /I’m back/ }).click();
    await panel.getByRole('button', { name: 'Start fresh' }).click();

    await panel.getByRole('button', { name: 'Brain dump' }).click();
    await panel.getByLabel('Everything on your mind').fill('1. DBMS assignment 2. email prof about the lab 3. laundry 4. pay mess fees, idk it feels like too much');
    await panel.getByRole('button', { name: 'Sort it for me' }).click();
    await panel.getByText('Just one to start with:').waitFor({ timeout: 40000 });
    await shot(panel, 'panel-brain-dump');

    // the gentle bubble and re-stuck chip on a real-looking page
    await task.bringToFront();
    await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'simulate', sim: 'stuck' }));
    await sleep(900);
    await shot(task, 'page-nudge');
    await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'simulate', sim: 'restuck' }));
    await sleep(900);
    await shot(task, 'page-restuck');

    // safety: never coaching, never stored
    await panel.bringToFront();
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.getByLabel(/What is it|Or type it/).fill('i am done with my life');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.getByText(/Tele-MANAS/).waitFor({ timeout: 10000 });
    await shot(panel, 'panel-safety');
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();

    // literal + dark
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByRole('radio', { name: 'Clear & literal' }).click();
    await panel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.getByLabel(/What is it|Or type it/).fill('DBMS assignment');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 40000 });
    await shot(panel, 'panel-literal-dark');
  } finally {
    await ctx.close();
    server.close();
  }
}

async function dashboardShots() {
  const dash = spawn('npx', ['next', 'start', '-p', String(DASH_PORT)], { cwd: path.join(ROOT, 'dashboard'), stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${DASH_PORT}`;
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(base);
        break;
      } catch {
        await sleep(500);
      }
    }
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
    for (const [route, name] of [
      ['/', 'dashboard-today'],
      ['/noticed', 'dashboard-noticed'],
      ['/works', 'dashboard-works'],
      ['/wins', 'dashboard-wins'],
      ['/privacy', 'dashboard-privacy'],
    ]) {
      await page.goto(base + route);
      await page.getByText('Sample data (demo mode)').waitFor({ timeout: 15000 });
      await shot(page, name);
    }
    await page.goto(base + '/');
    await page.getByText('Sample data (demo mode)').waitFor();
    await page.getByRole('radio', { name: /^1 spoon/ }).click();
    await shot(page, 'dashboard-energy-low');
    await browser.close();
  } finally {
    dash.kill();
  }
}

(async () => {
  await extensionShots();
  await dashboardShots();
  console.log(`\nScreenshots written to ${path.relative(ROOT, OUT)}/`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
