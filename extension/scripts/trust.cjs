/* Trust checks from a tester's review: typed words are honoured and never leak,
 * worrying words never become a task, a slow helper never means a long spinner,
 * the hotkey / closing the panel never throws away a step or timer, the safety
 * screen takes focus, and buttons stay big at every text size.
 * Usage: node scripts/trust.cjs [screenshotDir]   (run `npm run build` first) */
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
const outDir = process.argv[2] || path.join(os.tmpdir(), 'nudge-trust');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

/** Mock helper: "zzslow" requests answer after 12 s; everything else is refused (→ built-in cards). */
const seen = { slow: 0, lastTop: 0 };
function mockBackend() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.end();
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/sequence') {
          try {
            seen.lastTop = JSON.parse(body).top_strategies.length;
          } catch {
            /* ignore */
          }
          if (body.includes('zzslow')) {
            seen.slow += 1;
            return setTimeout(
              () =>
                res.end(
                  JSON.stringify({
                    mode: 'coach', lead: null, next_step: 'LATE REPLY that must be ignored.', why_one_line: 'x', size: 'tiny',
                    buttons: ['done', 'too_big', 'smaller', 'different', 'rest'], strategy_id: 'just_open_it', strategy_name: 'Just open it',
                    validation: null, suggest_rest: false, source: 'card', safety: null,
                  }),
                ),
              12_000,
            );
          }
        }
        res.statusCode = 503;
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const backend = await mockBackend();
  const bport = backend.address().port;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-trust-')), {
    headless: true,
    channel: 'chromium',
    viewport: { width: 400, height: 860 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const errors = [];
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    await sleep(1000);
    for (const p of ctx.pages()) if (p.url().includes('onboarding.html')) await p.close();

    let panel = await ctx.newPage();
    const openPanel = async () => {
      panel = await ctx.newPage();
      panel.on('pageerror', (e) => errors.push(String(e)));
      await panel.goto(`chrome-extension://${id}/sidepanel.html`);
      await sleep(900);
      return panel;
    };
    panel.on('pageerror', (e) => errors.push(String(e)));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('h1').first().waitFor();
    await panel.evaluate(async (bport) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, onboarded: true, inputStyle: 'buttons', backendUrl: `http://127.0.0.1:${bport}`, taskTab: null } });
    }, bport);
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    const all = async () => JSON.stringify(await panel.evaluate(async () => ({ ...(await chrome.storage.local.get(null)), ...(await chrome.storage.session.get(null)) })));
    const home = async () => {
      await panel.getByRole('button', { name: 'Nudge home' }).click();
      await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    };
    const ask = async (text) => {
      await panel.getByLabel(/Or type it|What is it/).fill(text);
      await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    };
    const stepText = () => panel.locator('.step-text').innerText();
    /** Tap "Done" — if the step happens to be a rest card ("Rest now"), ask for a different idea first. */
    const tapDone = async () => {
      for (let i = 0; i < 4; i++) {
        const btn = panel.locator('.actions .btn.done');
        await btn.waitFor({ timeout: 15000 });
        if (!/Rest now/i.test(await btn.innerText())) return btn.click();
        await panel.getByRole('button', { name: 'Different idea' }).click();
        await panel.locator('.step-text').waitFor({ timeout: 15000 });
      }
      throw new Error('only rest cards came back');
    };

    // ── 1. typed words are honoured; an old task never leaks ──
    await ask('laundry');
    await panel.locator('.step-text').waitFor({ timeout: 15000 });
    const laundryStep = await stepText();
    check('a chore gets a chore step (no headings / rubric / paragraphs)', !/heading|rubric|paragraph|title of/i.test(laundryStep), laundryStep);
    await home();
    await ask("ugh I can't start my essay");
    await panel.locator('.step-text').waitFor({ timeout: 15000 });
    const essayStep = await stepText();
    const ses = await panel.evaluate(async () => (await chrome.storage.local.get('session')).session);
    check('"ugh I can\'t start my essay" after laundry → an essay session, no laundry leak', ses.task === 'essay' && !/laundry/i.test(essayStep), `task=${ses.task} | ${essayStep}`);
    check('…and a kind word comes first', (await panel.locator('.validation, [data-validation]').count()) > 0 || /lot|heavy|hard|sense/i.test(await panel.locator('main').innerText()));
    check('every card score is sent, not just the top 12', seen.lastTop >= 50, `sent ${seen.lastTop}`);
    await panel.screenshot({ path: path.join(outDir, '01-essay-step.png'), fullPage: true });

    // ── 2. worrying words never become a task, never stored ──
    await home();
    await ask('I want to end it');
    await sleep(1500);
    const onSafety = (await panel.getByText(/Tele-MANAS/).count()) > 0;
    const steps = onSafety ? '' : await panel.locator('.step-text').innerText().catch(() => '');
    const stored = await all();
    check('"I want to end it" → support, or at least never echoed as a task', onSafety || !/end it/i.test(steps), onSafety ? 'safety screen' : steps);
    check('"I want to end it" is stored nowhere', !/want to end it/i.test(stored));
    if (onSafety) {
      const focused = await panel.evaluate(() => document.activeElement && document.activeElement.id);
      check('safety screen takes focus (screen readers hear it straight away)', focused === 'safety-heading', `focused=${focused}`);
      await panel.getByRole('button', { name: 'Back to Nudge' }).click();
    }
    await home();
    await ask("I don't want to be alive anymore");
    await panel.getByText(/Tele-MANAS/).waitFor({ timeout: 8000 });
    const focused = await panel.evaluate(() => document.activeElement && document.activeElement.id);
    check('safety screen moves focus to its heading', focused === 'safety-heading', `focused=${focused}`);
    await panel.screenshot({ path: path.join(outDir, '02-safety.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();

    // ── 3. slow helper: quick idea after ~2.5 s, late reply ignored, one request ──
    await home();
    const t0 = Date.now();
    await ask('zzslow essay');
    const quick = panel.getByRole('button', { name: 'Give me a quick idea now' });
    await quick.waitFor({ timeout: 5000 });
    const shownAfter = Date.now() - t0;
    check('"Give me a quick idea now" appears within ~3 s', shownAfter < 4500, `${shownAfter} ms`);
    await panel.screenshot({ path: path.join(outDir, '03-still-thinking.png'), fullPage: true });
    await quick.click();
    const t1 = Date.now();
    await panel.locator('.step-text').waitFor({ timeout: 3000 });
    const quickStep = await stepText();
    check('tapping it shows a step at once', Date.now() - t1 < 1500, `${Date.now() - t1} ms`);
    await sleep(11_500);
    check('the late helper reply never replaces it', (await stepText()) === quickStep && !/LATE REPLY/.test(await panel.locator('main').innerText()));
    check('no double request', seen.slow === 1, `requests=${seen.slow}`);

    // ── 4. hotkey / toolbar keeps the current step ──
    await panel.evaluate(() => chrome.storage.session.set({ panelIntent: { screen: 'stuck', state: 'stuck', t: Date.now() } }));
    await sleep(1500);
    check('hotkey while a step is open keeps that step', (await panel.locator('.step-text').count()) === 1 && (await stepText()) === quickStep);

    // ── 5. closing and reopening the panel restores the step ──
    await panel.close();
    await openPanel();
    await panel.locator('.step-text').waitFor({ timeout: 5000 }).catch(() => undefined);
    check('reopening the panel restores the step', (await panel.locator('.step-text').count()) === 1 && (await stepText()) === quickStep);

    // ── 6. …and a running body-double timer, with time still counting ──
    await tapDone();
    await panel.getByRole('button', { name: 'Body-double mode' }).click();
    await panel.getByRole('heading', { name: 'Here with you' }).waitFor();
    await sleep(800);
    const ui1 = await panel.evaluate(async () => (await chrome.storage.local.get('panelUi')).panelUi);
    await panel.close();
    await sleep(1500);
    await openPanel();
    const restoredBd = (await panel.getByRole('heading', { name: 'Here with you' }).count()) === 1;
    const ui2 = await panel.evaluate(async () => (await chrome.storage.local.get('panelUi')).panelUi);
    check('reopening the panel restores the body-double timer', restoredBd);
    check('…without restarting the clock', !!ui1?.bodyDouble && ui2?.bodyDouble?.startedAt === ui1.bodyDouble.startedAt, JSON.stringify([ui1?.bodyDouble, ui2?.bodyDouble]));
    await panel.screenshot({ path: path.join(outDir, '04-body-double-restored.png'), fullPage: true });
    await panel.evaluate(() => chrome.storage.session.set({ panelIntent: { screen: 'stuck', state: 'stuck', t: Date.now() } }));
    await sleep(1200);
    check('hotkey during a body-double timer keeps the timer', (await panel.getByRole('heading', { name: 'Here with you' }).count()) === 1);
    await panel.getByRole('button', { name: 'Stop for now' }).click();

    // ── 7. big buttons at every text size ──
    const measure = () =>
      panel.evaluate(() =>
        [...document.querySelectorAll('main button, header button')]
          .filter((b) => b.offsetParent !== null)
          .map((b) => {
            const cs = getComputedStyle(b);
            const r = b.getBoundingClientRect();
            return { t: (b.innerText || b.getAttribute('aria-label') || '').slice(0, 24), fs: parseFloat(cs.fontSize), h: r.height, clip: b.scrollWidth > b.clientWidth + 1, link: b.classList.contains('link') };
          }),
      );
    const pageScroll = () => panel.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const screens = async (label) => {
      const bad = [];
      await home();
      for (const b of await measure()) if (!b.link && (b.fs < 16 || b.h < 44 || b.clip)) bad.push(`home:${b.t}(${b.fs}px,${Math.round(b.h)}h${b.clip ? ',clipped' : ''})`);
      await ask('essay');
      await panel.locator('.step-text').waitFor({ timeout: 15000 });
      for (const b of await measure()) if (!b.link && (b.fs < 16 || b.h < 44 || b.clip)) bad.push(`step:${b.t}(${b.fs}px,${Math.round(b.h)}h${b.clip ? ',clipped' : ''})`);
      if (await pageScroll()) bad.push('step: page scrolls sideways');
      await panel.screenshot({ path: path.join(outDir, `05-step-${label}.png`), fullPage: true });
      await tapDone();
      await panel.getByRole('button', { name: 'Body-double mode' }).waitFor();
      for (const b of await measure()) if (!b.link && (b.fs < 16 || b.h < 44 || b.clip)) bad.push(`celebrate:${b.t}(${b.fs}px,${Math.round(b.h)}h${b.clip ? ',clipped' : ''})`);
      return bad;
    };
    const normal = await screens('normal');
    check('every button ≥ 16px text and ≥ 44px tall, nothing clipped', normal.length === 0, normal.join(' '));
    await panel.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, a11y: { ...settings.a11y, font: 'dyslexic', textScale: 1.3 } } });
    });
    await sleep(500);
    const big = await screens('dyslexic-1.3');
    check('…also with the dyslexia-friendly font at 130% text', big.length === 0, big.join(' '));

    check('no page errors in the panel', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('trust run finished without crashing', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  } finally {
    await ctx.close();
    backend.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} trust checks passed. Screenshots: ${outDir}`);
  process.exit(passed === results.length ? 0 : 1);
})();
