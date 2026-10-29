/* Full-system end-to-end test: extension + backend + dashboard, like a real user.
 *
 *   npm run e2e                 (from the repo root)
 *   node e2e/full.cjs [outDir]
 *
 * It starts what it needs and cleans up afterwards:
 *   - backend   http://localhost:8000   (backend/.venv must exist; skipped tests otherwise)
 *   - dashboard http://localhost:3000   (`next start`; needs `npm run build -w dashboard`)
 *   - dashboard http://localhost:3001   (same build — NOT a bridge origin → demo mode)
 *   - hostile   http://127.0.0.1:4000   (tries to talk to the bridge from outside)
 *   - task page http://127.0.0.2:4100   (a pretend assignment page)
 *   - slow      http://127.0.0.1:8001   (a /health that never answers in time)
 * Requires `npm run build -w extension` (extension/dist).
 * Run a subset with E2E_ONLY='regex' (matched against test names).
 */
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
  throw new Error('playwright not found — install it with `npm i -D playwright`');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'extension', 'dist');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'nudge-e2e');
fs.mkdirSync(OUT, { recursive: true });
const AXE_SRC = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [ROOT] }), 'utf8');
const STRATEGIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'src', 'strategies.json'), 'utf8'));
const NAME = Object.fromEntries(STRATEGIES.map((c) => [c.id, c.name]));

const DASH = 'http://localhost:3000';
const DASH_ALT = 'http://127.0.0.1:3000';
const DASH_OTHER = 'http://localhost:3001';
const PAGES = ['/', '/noticed', '/works', '/wins', '/privacy', '/settings', '/demo', '/insights'];

// ───────────── tiny test harness ─────────────
const results = [];
function record(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;
async function test(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    const r = await fn();
    if (r === false) record(name, false);
    else if (typeof r === 'string') record(name, true, r);
    else record(name, true);
  } catch (e) {
    record(name, false, String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 8000, every = 200, msg = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${msg}`);
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full, animations: 'disabled' }).catch(() => undefined);

// ───────────── services ─────────────
const children = [];
const servers = [];

async function isUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

function start(cmd, args, cwd, name) {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => code && code !== 143 && console.log(`[${name}] exited ${code}\n${log.slice(-800)}`));
  children.push(child);
  return child;
}

function serve(host, port, handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(port, host, () => resolve(s));
    servers.push(s);
  });
}

const TASK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>DBMS_Assignment</title></head>
<body style="font-family:sans-serif;padding:40px"><h1>DBMS Assignment 3</h1><p>Q1. Normalise the relation to 3NF.</p>
<textarea id="answer" rows="6" cols="60" aria-label="answer"></textarea></body></html>`;

// A page on another origin that tries to drive the extension / fool the dashboard.
const HOSTILE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Not the dashboard</title></head><body>
<p id="log">hostile page</p>
<script>
  window.results = { replies: 0 };
  window.addEventListener('message', (e) => { if (e.data && e.data.source === 'nudge-extension') window.results.replies++; });
  // 1) Pretend to be the dashboard on this origin
  window.postMessage({ source: 'nudge-dashboard', id: 'evil-1', request: { type: 'deleteAll' } }, '*');
  window.postMessage({ source: 'nudge-dashboard', id: 'evil-2', request: { type: 'getSnapshot' } }, '*');
  // 2) Talk INTO the real dashboard from outside
  window.attack = (url) => {
    const w = window.open(url, 'dash');
    let n = 0;
    const t = setInterval(() => {
      n++;
      try {
        w.postMessage({ source: 'nudge-dashboard', id: 'evil-' + n, request: { type: 'deleteAll' } }, '*');
        w.postMessage({ source: 'nudge-extension', type: 'hello', version: 'evil' }, '*');
        w.postMessage({ source: 'nudge-extension', type: 'reply', id: 'x', ok: true, data: { settings: {} } }, '*');
      } catch (e) {}
      if (n > 60) clearInterval(t);
    }, 50);
  };
  // 3) Frame the dashboard and poke it
  window.frameAttack = (url) => {
    const f = document.createElement('iframe');
    f.src = url; f.width = 400; f.height = 300; document.body.appendChild(f);
    let n = 0;
    const t = setInterval(() => { n++; try { f.contentWindow.postMessage({ source: 'nudge-dashboard', id: 'evil-f' + n, request: { type: 'deleteAll' } }, '*'); } catch (e) {} if (n > 40) clearInterval(t); }, 50);
  };
</script></body></html>`;

async function startServices() {
  // backend
  let backend = await isUp('http://localhost:8000/health');
  const py = path.join(ROOT, 'backend', '.venv', 'bin', 'uvicorn');
  if (!backend && fs.existsSync(py)) {
    start(py, ['app.main:app', '--port', '8000', '--no-access-log'], path.join(ROOT, 'backend'), 'backend');
    backend = await until(() => isUp('http://localhost:8000/health'), { timeout: 30000, msg: 'backend' }).catch(() => false);
  }
  // dashboards (production build)
  const nextBin = path.join(ROOT, 'node_modules', '.bin', 'next');
  assert(fs.existsSync(path.join(ROOT, 'dashboard', '.next', 'BUILD_ID')), 'dashboard not built — run `npm run build -w dashboard`');
  for (const port of [3000, 3001]) {
    if (await isUp(`http://localhost:${port}/`)) throw new Error(`port ${port} is already in use — stop it first`);
    start(nextBin, ['start', '-p', String(port)], path.join(ROOT, 'dashboard'), `dashboard:${port}`);
  }
  await until(() => isUp(`${DASH}/`), { timeout: 30000, msg: 'dashboard :3000' });
  await until(() => isUp(`${DASH_OTHER}/`), { timeout: 30000, msg: 'dashboard :3001' });
  await serve('127.0.0.2', 4100, (_q, r) => {
    r.setHeader('Content-Type', 'text/html; charset=utf-8');
    r.end(TASK_HTML);
  });
  await serve('127.0.0.1', 4000, (_q, r) => {
    r.setHeader('Content-Type', 'text/html; charset=utf-8');
    r.end(HOSTILE_HTML);
  });
  // a helper that hangs forever on /health
  await serve('127.0.0.1', 8001, () => undefined);
  return { backend };
}

function stopServices() {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  for (const s of servers) s.close();
}

// ───────────── page helpers ─────────────
async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function axe(page) {
  await page.evaluate(AXE_SRC + '\n;0');
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  });
}

async function waitConnected(page) {
  await page.getByText('Connected to your Nudge extension').waitFor({ timeout: 10000 });
}

async function gotoDash(page, route = '/', base = DASH) {
  await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  await page.locator('main h1').first().waitFor({ timeout: 15000 });
}

// ───────────── main ─────────────
(async () => {
  const consoleErrors = [];
  let ctx;
  let sw;
  let svc = { backend: false };
  try {
    svc = await startServices();
    record('services started', true, `backend ${svc.backend ? 'up' : 'not available'}`);

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-e2e-'));
    ctx = await chromium.launchPersistentContext(profile, {
      headless: true,
      channel: 'chromium',
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const storeGet = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);
    const sessionGet = (keys) => sw.evaluate((k) => chrome.storage.session.get(k), keys);
    const watch = (p) => {
      p.on('pageerror', (e) => consoleErrors.push(`${p.url()}: ${e}`));
      p.on('console', (m) => {
        if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource|status of 50[01]|net::ERR/.test(m.text())) consoleErrors.push(`${p.url()}: ${m.text()}`);
      });
      return p;
    };
    await sleep(1000);
    for (const p of ctx.pages()) if (p.url().includes('onboarding.html')) await p.close();

    const task = watch(await ctx.newPage());
    await task.goto('http://127.0.0.2:4100/');

    // finish onboarding through the side panel page so the extension is "real"
    const panel = watch(await ctx.newPage());
    await panel.setViewportSize({ width: 400, height: 860 });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.getByText('Hi, I’m Nudge.').waitFor();
    const tabChoice = panel.getByRole('radio', { name: /DBMS_Assignment/ });
    if (await tabChoice.count()) await tabChoice.first().click();
    await panel.getByRole('button', { name: /continue/i }).first().click();
    await panel.getByRole('radio', { name: /Warm & casual/ }).click();
    await panel.getByRole('button', { name: 'Continue' }).click();
    await panel.getByRole('radio', { name: /Buttons only/ }).click();
    await panel.getByRole('button', { name: 'All set' }).click();
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();

    const dash = watch(await ctx.newPage());

    // ── connected mode ──
    await test('connected: pill says connected on localhost:3000', async () => {
      await gotoDash(dash, '/');
      await waitConnected(dash);
    });

    await test('connected: also works on 127.0.0.1:3000', async () => {
      const p = watch(await ctx.newPage());
      await gotoDash(p, '/', DASH_ALT);
      await waitConnected(p);
      await p.close();
    });

    await test('connected: snapshot shows the extension’s real data (pinned task tab)', async () => {
      const { settings } = await storeGet('settings');
      assert(settings.onboarded, 'extension not onboarded');
      await gotoDash(dash, '/settings');
      // wording style from the extension is reflected
      const warm = dash.getByRole('radio', { name: /Warm & casual/ });
      assert(await warm.isChecked(), 'warm not checked');
      return `pinned: ${settings.taskTab && settings.taskTab.title}`;
    });

    await test('connected: Load 1-week sample (with confirm) updates extension storage', async () => {
      await gotoDash(dash, '/demo');
      await dash.getByRole('button', { name: 'Load 1-week sample history' }).click();
      const dlg = dash.getByRole('dialog');
      await dlg.waitFor();
      assert((await dlg.innerText()).includes('Replace with sample data?'), 'confirm missing');
      await shot(dash, 'connected-confirm-sample', false);
      await dash.getByRole('button', { name: 'Yes, load the sample' }).click();
      const s = await until(async () => {
        const v = await storeGet(['wins', 'inferences', 'settings']);
        return v.wins && v.wins.length > 15 ? v : null;
      }, { msg: 'sample wins in extension' });
      assert(s.settings.demoMode === true, 'demoMode not set');
      return `${s.wins.length} wins, ${s.inferences.length} inferences`;
    });

    await test('connected: Today shows the extension’s plan items', async () => {
      await gotoDash(dash, '/');
      const { plan } = await storeGet('plan');
      const today = plan.filter((p) => p.status === 'today');
      // the energy dial may hide some behind the offer, so check at least the first kept item renders
      await dash.getByText(today[0].title.split(' — ')[0], { exact: false }).first().waitFor();
      await shot(dash, 'connected-today');
    });

    await test('energy dial → extension storage → side panel shows it', async () => {
      await gotoDash(dash, '/');
      await dash.getByRole('radio', { name: /^1 spoon/ }).click();
      await until(async () => ((await storeGet('energyToday')).energyToday || {}).energy === 1, { msg: 'energy 1 in storage' });
      await panel.reload();
      await panel.getByText(/Running on empty/).first().waitFor({ timeout: 5000 });
      await shot(panel, 'panel-energy-1');
      // put it back
      await dash.getByRole('radio', { name: /^3 spoons/ }).click();
      await until(async () => ((await storeGet('energyToday')).energyToday || {}).energy === 3, { msg: 'energy 3' });
    });

    await test('low energy offers (never forces) saving items for later', async () => {
      await dash.getByRole('radio', { name: /^1 spoon/ }).click();
      const offer = dash.getByRole('region', { name: 'Suggestion' });
      await offer.waitFor();
      const before = (await storeGet('plan')).plan.filter((p) => p.status === 'later').length;
      await sleep(500);
      const after = (await storeGet('plan')).plan.filter((p) => p.status === 'later').length;
      assert(before === after, 'items moved without asking');
      await offer.getByRole('button', { name: 'Save for later' }).click();
      await until(async () => (await storeGet('plan')).plan.filter((p) => p.status === 'later').length > before, { msg: 'moved after consent' });
      await dash.getByRole('radio', { name: /^3 spoons/ }).click();
    });

    await test('plan add → done → later round-trips through the extension', async () => {
      await gotoDash(dash, '/');
      await dash.locator('#new-item').fill('E2E: open the lab sheet');
      await dash.locator('form fieldset').getByText('Tiny', { exact: true }).click();
      await dash.getByRole('button', { name: 'Add', exact: true }).click();
      const added = await until(async () => (await storeGet('plan')).plan.find((p) => p.title === 'E2E: open the lab sheet'), { msg: 'added item' });
      assert(added.size === 'tiny' && added.status === 'today', 'wrong size/status');
      await dash.getByRole('button', { name: 'Mark "E2E: open the lab sheet" as done' }).click();
      await until(async () => (await storeGet('plan')).plan.find((p) => p.id === added.id).status === 'done', { msg: 'done' });
      // empty title is refused gently
      await dash.locator('#new-item').fill('   ');
      await dash.getByRole('button', { name: 'Add', exact: true }).click();
      const n = (await storeGet('plan')).plan.length;
      await sleep(400);
      assert((await storeGet('plan')).plan.length === n, 'blank item added');
    });

    await test('“Wrong” on an inference raises sensitivity in the extension', async () => {
      await gotoDash(dash, '/noticed');
      const before = (await storeGet('settings')).settings.sensitivity.stuck;
      const { inferences } = await storeGet('inferences');
      const target = [...inferences].reverse().find((i) => (i.state === 'stuck' || i.state === 'restuck') && !i.feedback);
      assert(target, 'no unrated stuck inference');
      const card = dash.locator(`li[data-ids~="${target.id}"]`).first();
      await card.getByRole('button', { name: 'Wrong' }).click();
      await until(async () => (await storeGet('settings')).settings.sensitivity.stuck > before, { msg: 'sensitivity up' });
      const after = (await storeGet('settings')).settings.sensitivity.stuck;
      await dash.getByText(/stronger signals/).first().waitFor();
      return `${before} → ${after}`;
    });

    await test('repeated stuck moments are grouped; one “Wrong” covers the group and tunes once', async () => {
      const ids = await sw.evaluate(async () => {
        const { inferences } = await chrome.storage.local.get('inferences');
        const base = new Date();
        base.setHours(14, 0, 0, 0);
        const add = [0, 12, 25].map((m, i) => ({ id: 'grp_' + i, t: base.getTime() + m * 60000, state: 'stuck', reason: `Switched tabs ${10 + i} times in 5 min, came back to DBMS_Assignment.pdf 3 times.`, acted: 'none' }));
        await chrome.storage.local.set({ inferences: [...inferences, ...add] });
        return add.map((a) => a.id);
      });
      const before = (await storeGet('settings')).settings.sensitivity.stuck;
      await gotoDash(dash, '/noticed');
      const row = dash.locator(`li[data-ids~="${ids[0]}"]`);
      await row.waitFor();
      const txt = await row.innerText();
      assert(/3 stuck moments this afternoon/.test(txt), 'group summary missing: ' + txt.slice(0, 120));
      assert((await row.getByRole('button', { name: 'Wrong' }).count()) === 1, 'more than one Wrong button in group');
      await dash.getByText('Getting stuck is normal.').waitFor();
      await shot(dash, 'noticed-grouped', false);
      await row.getByRole('button', { name: 'Wrong' }).click();
      await until(async () => {
        const { inferences } = await storeGet('inferences');
        return ids.every((id) => inferences.find((i) => i.id === id).feedback === 'wrong');
      }, { msg: 'all grouped marked wrong' });
      await sleep(600);
      const after = (await storeGet('settings')).settings.sensitivity.stuck;
      const expected = Math.min(2.5, Number((before * 1.2).toFixed(3)));
      assert(Math.abs(after - expected) < 0.002, `sensitivity ${before} → ${after}, expected ${expected}`);
      return `${before} → ${after}`;
    });

    await test('“What works for me” ranking matches the extension’s stats', async () => {
      const { stats } = await storeGet('stats');
      const expected = Object.entries(stats)
        .filter(([, s]) => s.up + s.down > 0)
        .map(([id, s]) => ({ id, rate: (1 + s.up) / (2 + s.up + s.down), tried: s.up + s.down + s.skip }))
        .sort((a, b) => b.rate - a.rate || b.tried - a.tried)
        .map((x) => NAME[x.id]);
      await gotoDash(dash, '/works');
      const shown = await dash.locator('#ranked ol > li span.break-words').allInnerTexts();
      assert(shown.length === expected.length, `count ${shown.length} vs ${expected.length}`);
      assert(JSON.stringify(shown) === JSON.stringify(expected), `order differs: ${shown.slice(0, 3)} vs ${expected.slice(0, 3)}`);
      return shown.slice(0, 3).join(', ');
    });

    await test('literal wording: energy dial uses digits and plain words', async () => {
      await gotoDash(dash, '/settings');
      await dash.getByText('Clear & literal', { exact: true }).click();
      await until(async () => (await storeGet('settings')).settings.wordingStyle === 'literal', { msg: 'literal' });
      await gotoDash(dash, '/');
      await dash.getByRole('radio', { name: '1 — Very low energy' }).waitFor();
      const spoons = await dash.locator('#energy').innerText();
      assert(!/🥄|spoon/i.test(spoons), 'spoon metaphor still shown in literal mode');
      await shot(dash, 'today-literal', false);
      await gotoDash(dash, '/settings');
      await dash.getByText('Warm & casual', { exact: true }).click();
      await until(async () => (await storeGet('settings')).settings.wordingStyle === 'warm', { msg: 'warm' });
    });

    await test('works: bar shows 👍 ÷ ratings, and a bad week says “Nothing has clicked yet”', async () => {
      const saved = (await storeGet('stats')).stats;
      await sw.evaluate(() => chrome.storage.local.set({ stats: { ugly_first_draft: { up: 0, down: 2, skip: 0, shown: 2, phrasingIndex: 0 }, change_location: { up: 0, down: 1, skip: 0, shown: 1, phrasingIndex: 0 } } }));
      await gotoDash(dash, '/works');
      await dash.getByText(/Nothing has clicked yet/).waitFor();
      const widths = await dash.locator('#ranked ol > li .bg-accent').evaluateAll((els) => els.map((e) => e.style.width));
      assert(widths.every((w) => w === '0%'), 'bars not empty: ' + widths.join(','));
      const ranks = await dash.locator('#ranked ol > li span.w-6').count();
      assert(ranks === 0, 'rank numbers shown on a bad week');
      await shot(dash, 'works-bad-week', false);
      await sw.evaluate((st) => chrome.storage.local.set({ stats: st }), saved);
    });

    await test('wins chart: quiet days show no “0”', async () => {
      await gotoDash(dash, '/wins');
      const labels = await dash.locator('figure > div').first().locator('span').allInnerTexts();
      assert(!labels.some((t) => t.trim() === '0'), 'zero printed: ' + labels.join(','));
    });

    await test('settings from dashboard apply in the side panel', async () => {
      await gotoDash(dash, '/settings');
      await dash.getByText('Dyslexia-friendly', { exact: true }).click();
      await dash.getByText('Largest', { exact: true }).click();
      await dash.getByText('Reduce motion', { exact: true }).click();
      await dash.getByText('Clear & literal', { exact: true }).click();
      await dash.getByRole('switch', { name: /High contrast/ }).click();
      const s = await until(async () => {
        const v = (await storeGet('settings')).settings;
        return v.a11y.font === 'dyslexic' && v.a11y.textScale === 1.5 && v.a11y.reducedMotion === 'on' && v.wordingStyle === 'literal' && v.a11y.highContrast ? v : null;
      }, { msg: 'settings in extension storage' });
      await panel.reload();
      await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
      const ds = await panel.evaluate(() => ({ ...document.documentElement.dataset, fs: document.documentElement.style.fontSize }));
      assert(ds.font === 'dyslexic', 'panel font ' + ds.font);
      assert(ds.contrast === 'high', 'panel contrast ' + ds.contrast);
      assert(ds.motion === 'off', 'panel motion ' + ds.motion);
      await shot(panel, 'panel-after-dashboard-settings');
      // the dashboard itself also applied them
      const dd = await dash.evaluate(() => ({ ...document.documentElement.dataset }));
      assert(dd.font === 'dyslexic' && dd.contrast === 'high' && dd.motion === 'off', 'dashboard attrs ' + JSON.stringify(dd));
      await shot(dash, 'dashboard-settings-dyslexic-contrast');
      return `textScale ${s.a11y.textScale}, panel fontSize ${ds.fs || '(css var)'}`;
    });

    await test('theme from dashboard (Wins) applies to panel', async () => {
      await gotoDash(dash, '/wins');
      const dusk = dash.getByRole('radio', { name: /Dusk/ });
      await dusk.click();
      await until(async () => (await storeGet('settings')).settings.theme === 'dusk', { msg: 'theme dusk' });
      await panel.reload();
      await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
      assert((await panel.evaluate(() => document.documentElement.dataset.accent)) === 'dusk', 'panel accent');
    });

    await test('settings from extension live-update the dashboard (no reload)', async () => {
      await gotoDash(dash, '/settings');
      await sw.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        settings.wordingStyle = 'warm';
        settings.a11y = { ...settings.a11y, font: 'default', highContrast: false, reducedMotion: 'system', textScale: 1 };
        await chrome.storage.local.set({ settings });
      });
      await until(() => dash.getByRole('radio', { name: /Warm & casual/ }).isChecked(), { msg: 'warm checked live' });
      await until(async () => (await dash.evaluate(() => document.documentElement.dataset.font)) === 'default', { msg: 'font reset live' });
    });

    await test('two dashboard tabs stay in sync', async () => {
      const other = watch(await ctx.newPage());
      await gotoDash(other, '/');
      await waitConnected(other);
      await gotoDash(dash, '/');
      await dash.getByRole('radio', { name: /^4 spoons/ }).click();
      await until(() => other.getByRole('radio', { name: /^4 spoons/ }).getAttribute('aria-checked').then((v) => v === 'true'), { msg: 'second tab updated' });
      await other.close();
      await dash.getByRole('radio', { name: /^3 spoons/ }).click();
    });

    await test('simulate stuck from dashboard shows the bubble in the active (dashboard) tab', async () => {
      await gotoDash(dash, '/demo');
      await dash.bringToFront();
      const before = (await storeGet('inferences')).inferences.length;
      await dash.getByRole('button', { name: 'Simulate stuck' }).click();
      await dash.locator('nudge-overlay').waitFor({ state: 'attached', timeout: 5000 });
      await sleep(500);
      await shot(dash, 'dashboard-sim-stuck-bubble', false);
      const after = (await storeGet('inferences')).inferences.length;
      assert(after === before + 1, 'inference not logged');
    });

    await test('simulate re-stuck / depleted / long break log inferences', async () => {
      for (const label of ['Simulate re-stuck', 'Simulate depleted', 'Simulate long break']) {
        const before = (await storeGet('inferences')).inferences.length;
        await dash.getByRole('button', { name: label }).click();
        await until(async () => (await storeGet('inferences')).inferences.length === before + 1, { msg: label });
      }
      await sleep(400);
      await shot(dash, 'dashboard-sim-long-break', false);
    });

    await test('simulate crisis: preview shows resources, nothing stored', async () => {
      await dash.getByRole('button', { name: 'Simulate crisis phrase' }).click();
      await dash.getByText('14416').first().waitFor();
      await shot(dash, 'dashboard-sim-crisis', false);
      const all = JSON.stringify(await sw.evaluate(async () => ({ l: await chrome.storage.local.get(null), s: await chrome.storage.session.get(null) })));
      assert(!/alive anymore|be here anymore|kill myself/i.test(all), 'crisis text stored');
      const dashLs = await dash.evaluate(() => JSON.stringify(localStorage));
      assert(!/alive anymore|be here anymore|kill myself/i.test(dashLs), 'crisis text in dashboard localStorage');
    });

    // ── privacy ──
    await test('backend up → privacy shows where the AI runs', async () => {
      if (!svc.backend) return 'skipped (no backend)';
      await gotoDash(dash, '/privacy');
      await until(async () => /local|built-in|cloud/i.test(await dash.locator('#ai').innerText()), { msg: 'health shown' });
      return (await dash.locator('#ai').innerText()).split('\n').slice(1, 3).join(' | ');
    });

    await test('slow backend → health check times out gracefully', async () => {
      await gotoDash(dash, '/settings');
      const { settings } = await storeGet('settings');
      await sw.evaluate(async () => {
        const { settings: s } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...s, backendUrl: 'http://127.0.0.1:8001' } });
      });
      await gotoDash(dash, '/privacy');
      const t0 = Date.now();
      await until(async () => /built-in|isn.t answering|off/i.test(await dash.locator('#ai').innerText()), { timeout: 8000, msg: 'offline message' });
      const ms = Date.now() - t0;
      await shot(dash, 'privacy-backend-slow', false);
      await sw.evaluate(async (url) => {
        const { settings: s } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...s, backendUrl: url } });
      }, settings.backendUrl);
      return `offline message after ${ms} ms`;
    });

    await test('backend down → privacy says built-in cards are used', async () => {
      const { settings } = await storeGet('settings');
      await sw.evaluate(async () => {
        const { settings: s } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...s, backendUrl: 'http://127.0.0.1:8999' } });
      });
      await gotoDash(dash, '/privacy');
      await until(async () => /built-in/i.test(await dash.locator('#ai').innerText()), { msg: 'built-in cards message' });
      await sw.evaluate(async (url) => {
        const { settings: s } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...s, backendUrl: url } });
      }, settings.backendUrl);
    });

    await test('per-site exclusion stops counting on that host', async () => {
      // baseline: typing on the task page produces interact events
      const typeOnTask = async () => {
        await task.bringToFront();
        await task.locator('#answer').click();
        await task.keyboard.type('hello world', { delay: 10 });
      };
      const sawInteract = async (ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const raw = (await sessionGet('rawEvents')).rawEvents || [];
          if (raw.some((e) => e.kind === 'interact' && e.host === '127.0.0.2')) return true;
          await sleep(300);
        }
        return false;
      };
      await typeOnTask();
      const before = await sawInteract(13000);
      assert(before, 'control: no interact events before excluding');
      await gotoDash(dash, '/privacy');
      const input = dash.getByLabel('Never notice on these sites');
      await input.fill('http://127.0.0.2:4100/some/path');
      await input.press('Enter');
      await until(async () => ((await storeGet('settings')).settings.excludedSites || []).includes('127.0.0.2'), { msg: 'exclusion saved (hostname cleaned)' });
      await sw.evaluate(() => chrome.storage.session.set({ rawEvents: [] }));
      await typeOnTask();
      const after = await sawInteract(13000);
      assert(!after, 'still counting on excluded host');
      // undo
      await dash.bringToFront();
      await dash.getByRole('button', { name: 'Remove 127.0.0.2' }).click();
      await until(async () => !((await storeGet('settings')).settings.excludedSites || []).includes('127.0.0.2'), { msg: 'exclusion removed' });
    });

    await test('pause tracking stops sensing (no new feature windows after a tick)', async () => {
      await gotoDash(dash, '/privacy');
      await dash.getByRole('switch', { name: /Pause all noticing/ }).click();
      await until(async () => (await storeGet('settings')).settings.trackingPaused === true, { msg: 'paused' });
      const f0 = ((await storeGet('features')).features || []).length;
      await task.bringToFront();
      await task.locator('#answer').click();
      await task.keyboard.type('more typing while paused', { delay: 10 });
      await sleep(35000); // one 30 s alarm tick
      const f1 = ((await storeGet('features')).features || []).length;
      const raw = (await sessionGet('rawEvents')).rawEvents || [];
      assert(f1 === f0, `features grew ${f0} → ${f1}`);
      assert(raw.length === 0, `raw events while paused: ${raw.length}`);
      await dash.bringToFront();
      await dash.getByRole('switch', { name: /Pause all noticing/ }).click();
      await until(async () => (await storeGet('settings')).settings.trackingPaused === false, { msg: 'unpaused' });
      return `features stayed at ${f0}`;
    });

    await test('export downloads JSON without raw events or visited URLs', async () => {
      await gotoDash(dash, '/privacy');
      const [dl] = await Promise.all([dash.waitForEvent('download'), dash.getByRole('button', { name: 'Export my data' }).click()]);
      const file = path.join(OUT, 'export.json');
      await dl.saveAs(file);
      const txt = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(txt);
      assert(!('rawEvents' in data), 'rawEvents exported');
      assert(!/127\.0\.0\.2:4100|\/some\/path|localhost:3000\//.test(txt), 'visited URL in export');
      assert(data.settings && Array.isArray(data.wins), 'missing data');
      return `${(txt.length / 1024).toFixed(1)} KB, keys: ${Object.keys(data).length}`;
    });

    // ── security: other origins ──
    await test('hostile page on another origin gets no bridge replies and changes nothing', async () => {
      const winsBefore = (await storeGet('wins')).wins.length;
      const evil = watch(await ctx.newPage());
      await evil.goto('http://127.0.0.1:4000/');
      await sleep(1500);
      const replies = await evil.evaluate(() => window.results.replies);
      assert(replies === 0, `bridge replied ${replies} times`);
      // talk INTO the real dashboard from a popup handle, and frame it
      await evil.evaluate((u) => window.attack(u), DASH + '/');
      await evil.evaluate((u) => window.frameAttack(u), DASH + '/');
      await sleep(4000);
      const s = await storeGet(['wins', 'settings']);
      assert(s.settings.onboarded && s.wins.length === winsBefore, 'storage was changed by a hostile page');
      for (const p of ctx.pages()) if (p !== evil && p.url().startsWith(DASH) && p !== dash) await p.close();
      await evil.close();
    });

    await test('dashboard on another port (3001) runs demo mode, bridge stays silent', async () => {
      const p = watch(await ctx.newPage());
      await gotoDash(p, '/', DASH_OTHER);
      await p.getByText('Sample data (demo mode)').waitFor({ timeout: 8000 });
      const got = await p.evaluate(
        () =>
          new Promise((resolve) => {
            let n = 0;
            addEventListener('message', (e) => e.data && e.data.source === 'nudge-extension' && n++);
            postMessage({ source: 'nudge-dashboard', id: 't1', request: { type: 'getSnapshot' } }, location.origin);
            setTimeout(() => resolve(n), 1200);
          }),
      );
      assert(got === 0, 'got extension replies on :3001');
      await shot(p, 'demo-mode-3001', false);
      await p.close();
    });

    await test('fake “extension hello” from another window cannot flip demo mode to connected', async () => {
      const evil = watch(await ctx.newPage());
      await evil.goto('http://127.0.0.1:4000/');
      await evil.evaluate((u) => window.attack(u), DASH_OTHER + '/');
      await sleep(4500);
      const popup = ctx.pages().find((p) => p.url().startsWith(DASH_OTHER));
      assert(popup, 'popup missing');
      const pill = await popup.locator('[role=status]').first().innerText();
      assert(/Sample data/.test(pill), 'pill: ' + pill);
      await popup.close();
      await evil.close();
    });

    // ── big data ──
    await test('5,000 inferences + 5,000 wins: pages stay responsive', async () => {
      await sw.evaluate(async () => {
        const now = Date.now();
        const states = ['stuck', 'flow', 'depleted', 'away', 'restuck'];
        const inferences = Array.from({ length: 5000 }, (_, i) => ({ id: 'big_' + i, t: now - i * 60000, state: states[i % 5], reason: `Synthetic reason number ${i} with a little detail.`, acted: i % 3 ? 'none' : 'nudged' }));
        const kinds = ['started', 'step_done', 'paused_start', 'rested'];
        const wins = Array.from({ length: 5000 }, (_, i) => ({ id: 'bw_' + i, t: now - i * 90000, kind: kinds[i % 4], label: `Synthetic win ${i}` }));
        await chrome.storage.local.set({ inferences, wins });
      });
      const timings = [];
      for (const route of ['/', '/noticed', '/wins', '/works']) {
        const t0 = Date.now();
        await gotoDash(dash, route);
        await waitConnected(dash);
        await dash.waitForLoadState('networkidle').catch(() => undefined);
        const ms = Date.now() - t0;
        const nodes = await dash.evaluate(() => document.querySelectorAll('*').length);
        timings.push(`${route} ${ms}ms/${nodes} nodes`);
        assert(ms < 8000, `${route} took ${ms} ms`);
        assert(nodes < 6000, `${route} renders ${nodes} DOM nodes`);
      }
      // interaction stays snappy
      await gotoDash(dash, '/noticed');
      await waitConnected(dash);
      const t1 = Date.now();
      await dash.getByRole('button', { name: 'Flow', exact: true }).click();
      await dash.getByText(/Synthetic reason number/).first().waitFor();
      timings.push(`filter ${Date.now() - t1}ms`);
      await shot(dash, 'big-data-noticed', false);
      return timings.join(', ');
    });

    // ── phone width + keyboard + reduced motion + axe (connected) ──
    await gotoDash(dash, '/demo');
    await dash.getByRole('button', { name: 'Load 1-week sample history' }).click();
    await dash.getByRole('button', { name: 'Yes, load the sample' }).click();
    await until(async () => ((await storeGet('wins')).wins || []).length < 100, { msg: 'sample reloaded' });

    await test('390 px: no horizontal scroll on any page (connected)', async () => {
      await dash.setViewportSize({ width: 390, height: 844 });
      const bad = [];
      for (const r of PAGES) {
        await gotoDash(dash, r);
        if (r !== '/insights') await waitConnected(dash);
        await sleep(200);
        if (!(await noHScroll(dash))) bad.push(r);
        await shot(dash, `phone${r === '/' ? '-today' : r.replace('/', '-')}`);
      }
      await dash.setViewportSize({ width: 1280, height: 900 });
      assert(!bad.length, 'horizontal scroll on ' + bad.join(', '));
    });

    await test('keyboard: skip link works and every focus stop is visible', async () => {
      const problems = [];
      for (const r of PAGES) {
        await gotoDash(dash, r);
        if (r !== '/insights') await waitConnected(dash);
        await dash.evaluate(() => (document.activeElement && document.activeElement.blur && document.activeElement.blur(), window.scrollTo(0, 0)));
        await dash.keyboard.press('Tab');
        const first = await dash.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
        if (first !== 'Skip to content') problems.push(`${r}: first tab stop "${first}"`);
        await dash.keyboard.press('Enter');
        const onMain = await dash.evaluate(() => document.activeElement && document.activeElement.id);
        if (onMain !== 'main') problems.push(`${r}: skip link → ${onMain}`);
        for (let i = 0; i < 60; i++) {
          await dash.keyboard.press('Tab');
          const info = await dash.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
            const r = el.getBoundingClientRect();
            return { visible, tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30), small: r.width < 24 || r.height < 24, hidden: r.width === 0 || r.height === 0 };
          });
          if (!info) break;
          if (!info.visible) problems.push(`${r}: no focus ring on ${info.tag} "${info.label}"`);
        }
      }
      assert(!problems.length, problems.slice(0, 6).join(' | ') + (problems.length > 6 ? ` …+${problems.length - 6}` : ''));
    });

    await test('dialogs trap focus, Esc closes, focus returns', async () => {
      await gotoDash(dash, '/privacy');
      const trigger = dash.getByRole('button', { name: 'Delete everything' });
      await trigger.focus();
      await dash.keyboard.press('Enter');
      const dlg = dash.getByRole('dialog');
      await dlg.waitFor();
      for (let i = 0; i < 8; i++) {
        await dash.keyboard.press('Tab');
        const inside = await dash.evaluate(() => !!document.activeElement.closest('dialog, [role=dialog]'));
        assert(inside, 'focus escaped dialog');
      }
      await dash.keyboard.press('Shift+Tab');
      assert(await dash.evaluate(() => !!document.activeElement.closest('dialog, [role=dialog]')), 'shift-tab escaped');
      await dash.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
      const back = await dash.evaluate(() => document.activeElement.textContent.trim());
      assert(back === 'Delete everything', 'focus returned to ' + back);
    });

    await test('reduced motion: OS setting removes animations on dashboard', async () => {
      await dash.emulateMedia({ reducedMotion: 'reduce' });
      await gotoDash(dash, '/');
      await waitConnected(dash);
      const v = await dash.evaluate(() => {
        const els = [...document.querySelectorAll('*')];
        const moving = els.filter((el) => {
          const cs = getComputedStyle(el);
          return (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.01) || parseFloat(cs.transitionDuration) > 0.01;
        });
        return { motion: getComputedStyle(document.documentElement).getPropertyValue('--n-motion').trim(), moving: moving.length };
      });
      await dash.emulateMedia({ reducedMotion: 'no-preference' });
      assert(v.moving === 0, `${v.moving} elements still animate`);
      return `--n-motion=${v.motion}`;
    });

    const axeReport = {};
    await test('axe: no serious/critical issues on dashboard pages (connected)', async () => {
      const bad = [];
      for (const r of PAGES) {
        await gotoDash(dash, r);
        if (r !== '/insights') await waitConnected(dash);
        await sleep(300);
        const v = await axe(dash);
        axeReport['dashboard ' + r] = v;
        for (const x of v) if (x.impact === 'serious' || x.impact === 'critical') bad.push(`${r} ${x.id} (${x.nodes}) ${x.target[0]}`);
      }
      // dark mode too
      await dash.emulateMedia({ colorScheme: 'dark' });
      for (const r of ['/', '/noticed', '/privacy']) {
        await gotoDash(dash, r);
        await waitConnected(dash);
        await sleep(300);
        const v = await axe(dash);
        axeReport['dashboard dark ' + r] = v;
        for (const x of v) if (x.impact === 'serious' || x.impact === 'critical') bad.push(`dark ${r} ${x.id} (${x.nodes}) ${x.target[0]}`);
      }
      await dash.emulateMedia({ colorScheme: 'light' });
      assert(!bad.length, bad.join(' | '));
    });

    await test('axe: extension side panel + onboarding (report only)', async () => {
      const out = [];
      const pg = watch(await ctx.newPage());
      await pg.setViewportSize({ width: 400, height: 860 });
      await pg.goto(`chrome-extension://${extId}/sidepanel.html`);
      await pg.getByRole('heading', { name: "I'm stuck" }).waitFor();
      axeReport['panel home'] = await axe(pg);
      await pg.goto(`chrome-extension://${extId}/onboarding.html`);
      await pg.waitForLoadState('domcontentloaded');
      await sleep(800);
      axeReport['onboarding'] = await axe(pg);
      await pg.close();
      for (const k of ['panel home', 'onboarding']) for (const x of axeReport[k]) out.push(`${k}: ${x.impact} ${x.id} (${x.nodes})`);
      fs.writeFileSync(path.join(OUT, 'axe-report.json'), JSON.stringify(axeReport, null, 2));
      return out.length ? out.join(' | ') : 'no violations';
    });

    // ── disconnect + delete ──
    await test('delete everything wipes the extension and the panel returns to onboarding', async () => {
      await gotoDash(dash, '/privacy');
      await dash.getByRole('button', { name: 'Delete everything' }).click();
      await dash.getByRole('button', { name: 'Yes, delete it all' }).click();
      await until(async () => {
        const s = await storeGet(['settings', 'wins', 'inferences', 'plan', 'stats']);
        return s.settings && s.settings.onboarded === false && !s.wins.length && !s.inferences.length && !s.plan.length && !Object.keys(s.stats).length;
      }, { msg: 'wiped' });
      await panel.reload();
      await panel.getByText('Hi, I’m Nudge.').waitFor();
      await dash.getByText(/All cleared/).waitFor();
      await shot(dash, 'after-delete', false);
    });

    await test('extension reloaded mid-session → soft banner, no crash; “Try again” stays honest', async () => {
      await gotoDash(dash, '/');
      await waitConnected(dash);
      const newSw = ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
      await sw.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
      sw = (await newSw) || sw;
      await sleep(1500);
      // any action now times out → banner
      await dash.getByRole('radio', { name: /^2 spoons/ }).click();
      await dash.getByText(/can.t reach your Nudge extension/i).waitFor({ timeout: 10000 }).catch(() => {
        throw new Error('no disconnected banner');
      });
      await shot(dash, 'disconnected-banner', false);
      await dash.getByRole('button', { name: 'Try again' }).click();
      await sleep(2500);
      const pill = await dash.locator('[role=status]').first().innerText();
      assert(!/Sample data/.test(pill), 'silently switched to sample data: ' + pill);
      // Reloading the page: reconnects if the extension came back, otherwise a clearly
      // labelled sample-data mode (headless Chromium doesn't restart a reloaded unpacked extension).
      const back = ctx.serviceWorkers().length > 0;
      await dash.reload();
      if (back) await waitConnected(dash);
      else await dash.getByText('Sample data (demo mode)').waitFor({ timeout: 8000 });
      await shot(dash, 'after-reload-no-extension', false);
      return `after "Try again": ${pill}; after page reload: ${back ? 'connected' : 'sample data'}`;
    });

    // ── demo mode without extension, storage blocked ──
    await test('demo mode with localStorage blocked still renders every page', async () => {
      const b = await chromium.launch({ headless: true });
      const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
      await c.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      });
      const p = await c.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      for (const r of PAGES) {
        await gotoDash(p, r, DASH_OTHER);
        if (r !== '/insights') await p.getByText('Sample data (demo mode)').waitFor({ timeout: 8000 });
      }
      await p.goto(DASH_OTHER + '/');
      await p.getByRole('radio', { name: /^2 spoons/ }).click();
      await p.getByRole('radio', { name: /^2 spoons/ }).getAttribute('aria-checked').then((v) => assert(v === 'true', 'energy did not change in memory'));
      await shot(p, 'demo-storage-blocked', false);
      await b.close();
      assert(!errs.length, errs.join(' | '));
    });

    await test('no page errors anywhere during the run', async () => {
      const mine = consoleErrors.filter((e) => !/Extension context invalidated/.test(e));
      assert(!mine.length, mine.slice(0, 5).join(' | '));
    });

    await test('extension bridge: no uncaught errors after the extension reloads', async () => {
      const ext = consoleErrors.filter((e) => /Extension context invalidated/.test(e));
      assert(!ext.length, `${ext.length}× "Extension context invalidated" thrown by the bridge content script`);
    });
  } catch (e) {
    record('e2e harness', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  } finally {
    if (ctx) await ctx.close().catch(() => undefined);
    stopServices();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
