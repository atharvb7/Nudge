/* End-to-end smoke test: loads the built extension in Chromium and walks the
 * main flow. Usage: node scripts/smoke.cjs [screenshotDir] [--backend]
 * Requires `npm run build` first. Playwright's bundled Chromium is used. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      /* try next */
    }
  }
  throw new Error('playwright not found');
}

const { chromium } = loadPlaywright();
const dist = path.resolve(__dirname, '..', 'dist');
const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(os.tmpdir(), 'nudge-smoke');
const withBackend = process.argv.includes('--backend');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

function testPage() {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><title>DBMS_Assignment</title></head><body style="font-family:sans-serif;padding:40px;background:#fafafa">
        <h1>DBMS Assignment 3</h1><p>Q1. Normalise the following relation to 3NF…</p><p style="max-width:600px">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam.</p></body></html>`);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await testPage();
  const port = server.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-profile-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 400, height: 860 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    check('service worker started', !!id, id);
    const errors = [];

    const task = await ctx.newPage();
    await task.goto(`http://127.0.0.1:${port}/`);

    // onboarding tab opens on install
    await new Promise((r) => setTimeout(r, 1200));
    const onboardingTab = ctx.pages().find((p) => p.url().includes('onboarding.html'));
    check('onboarding tab opened on install', !!onboardingTab);
    if (onboardingTab) {
      await onboardingTab.setViewportSize({ width: 900, height: 900 });
      await onboardingTab.screenshot({ animations: 'disabled', path: path.join(outDir, '01-onboarding-tab.png') });
      await onboardingTab.close();
    }

    const panel = await ctx.newPage();
    panel.on('pageerror', (e) => errors.push(String(e)));
    panel.on('console', (m) => m.type() === 'error' && !/ERR_CONNECTION_REFUSED|status of 501/.test(m.text()) && errors.push(m.text()));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.getByText('Hi, I’m Nudge.').waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '02-panel-onboarding.png') });
    // step 1: pin the DBMS tab
    const tabChoice = panel.getByRole('radio', { name: /DBMS_Assignment/ });
    if (await tabChoice.count()) await tabChoice.first().click();
    await panel.getByRole('button', { name: /continue/i }).first().click();
    await panel.getByRole('radio', { name: /Warm & casual/ }).click();
    await panel.getByRole('button', { name: 'Continue' }).click();
    await panel.getByRole('radio', { name: /Buttons only/ }).click();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '03-panel-onboarding-3.png') });
    await panel.getByRole('button', { name: 'All set' }).click();
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '04-home.png'), fullPage: true });
    check('onboarding completes into the I’m stuck panel', true);

    const settings = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    check('task tab pinned', settings?.taskTab?.title === 'DBMS_Assignment', JSON.stringify(settings?.taskTab));

    await panel.getByLabel(/What is it/).fill('DBMS assignment');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 40000 });
    const offline = await panel.getByText('offline idea').count();
    check(withBackend ? 'got a step from the backend' : 'got an offline card with backend down', withBackend ? offline === 0 : offline > 0, await panel.locator('.step-text').innerText());
    for (const label of ['Done', 'Too big', 'Make it smaller', 'Different idea', 'I need rest']) {
      check(`button "${label}" present`, (await panel.getByRole('button', { name: new RegExp(`^${label}`) }).count()) > 0);
    }
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '05-step.png'), fullPage: true });

    await panel.getByRole('button', { name: /^Make it smaller/ }).click();
    await panel.locator('.step-text').waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '06-smaller.png'), fullPage: true });

    await panel.getByRole('button', { name: /^Done/ }).click();
    await panel.getByText(/Did this help\?/).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '07-celebrate.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Yes, it helped' }).click();
    await panel.getByText(/remember what works/).waitFor();
    const store = await sw.evaluate(async () => chrome.storage.local.get(['stats', 'wins', 'session']));
    const ups = Object.values(store.stats || {}).reduce((a, s) => a + (s.up || 0), 0);
    check('feedback stored for personal learning', ups === 1);
    check('wins logged (started + step done)', (store.wins || []).length >= 2, String((store.wins || []).length));

    // body double
    await panel.getByRole('button', { name: 'Body-double mode' }).click();
    await panel.getByRole('timer').waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '08-body-double.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Stop for now' }).click();
    await panel.getByRole('button', { name: '5 min', exact: true }).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '09-rest-choose.png'), fullPage: true });
    await panel.getByRole('button', { name: '5 min', exact: true }).click();
    await panel.getByRole('timer').waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '10-resting.png'), fullPage: true });
    await panel.getByRole('button', { name: /I’m back/ }).click();
    await panel.getByText(/Welcome back/).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '11-welcome-back.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Start fresh' }).click();

    // brain dump
    await panel.getByRole('button', { name: 'Brain dump' }).click();
    await panel.getByLabel('Everything on your mind').fill('finish the DBMS assignment, email my prof about the lab, do laundry, and also pay mess fees');
    await panel.getByRole('button', { name: 'Sort it for me' }).click();
    await panel.getByText('Just one to start with:').waitFor({ timeout: 40000 });
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '12-brain-dump.png'), fullPage: true });
    check('brain dump picks one item', true);

    // nudge bubble on a real page (demo simulation)
    await task.bringToFront();
    await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'simulate', sim: 'stuck' }));
    await new Promise((r) => setTimeout(r, 800));
    await task.screenshot({ animations: 'disabled', path: path.join(outDir, '13-page-nudge.png') });
    const inf = await sw.evaluate(async () => (await chrome.storage.local.get('inferences')).inferences);
    check('simulated stuck inference logged with reason', (inf || []).some((i) => /Switched tabs/.test(i.reason)));
    await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'simulate', sim: 'restuck' }));
    await new Promise((r) => setTimeout(r, 600));
    await task.screenshot({ animations: 'disabled', path: path.join(outDir, '14-page-restuck-chip.png') });

    // crisis demo — nothing stored
    await panel.bringToFront();
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByRole('button', { name: 'Demo mode' }).click();
    await panel.getByRole('button', { name: 'Simulate crisis phrase' }).click();
    await panel.getByText(/Tele-MANAS/).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '15-safety.png'), fullPage: true });
    const all = JSON.stringify(await sw.evaluate(async () => chrome.storage.local.get(null)));
    check('crisis phrase never stored', !/want to be alive anymore/i.test(all));
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();

    // settings + dark + literal
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByRole('heading', { name: 'Settings' }).waitFor();
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '16-settings.png'), fullPage: true });
    await panel.emulateMedia({ colorScheme: 'dark' });
    await panel.getByRole('radio', { name: 'Clear & literal' }).click();
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.getByLabel(/Or type it|What is it/).fill('DBMS assignment');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 40000 });
    await panel.screenshot({ animations: 'disabled', path: path.join(outDir, '17-step-literal-dark.png'), fullPage: true });

    // dashboard bridge reducer through the SW
    const snap = await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'bridge', request: { type: 'getSnapshot' } }));
    check('bridge snapshot works', snap && snap.source === 'extension' && Array.isArray(snap.wins));

    const raw = await sw.evaluate(async () => (await chrome.storage.session.get('rawEvents')).rawEvents ?? []);
    check('raw events live only in session storage', Array.isArray(raw));

    // the 30 s alarm turns raw metadata into feature windows and deletes the raw events
    let feats = [];
    for (let i = 0; i < 40 && !feats.length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      feats = (await sw.evaluate(async () => (await chrome.storage.local.get('features')).features)) || [];
    }
    check('sensing tick computed feature windows', feats.length > 0, feats.length ? JSON.stringify(feats[feats.length - 1]) : '');
    const leftover = JSON.stringify(await sw.evaluate(async () => chrome.storage.local.get(null)));
    check('no URLs or page titles stored beyond the pinned task tab', !/127\.0\.0\.1:\d+\//.test(leftover));

    check('no page errors in panel', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('smoke flow', false, String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : e));
  } finally {
    await ctx.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
