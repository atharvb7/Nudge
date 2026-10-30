/* Edge-case end-to-end checks: loads the built extension in Chromium and
 * pokes at the corners — keyboard-only bubble use, focus never stolen, tiny
 * viewports, strict-CSP pages, double injection, same-tab navigation, worker
 * restarts mid-break, safety scrubbing, slow helper, a11y settings, backend URL.
 * Usage: node scripts/edge.cjs [screenshotDir]   (run `npm run build` first) */
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
const outDir = process.argv[2] || path.join(os.tmpdir(), 'nudge-edge');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const PAGE = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:24px;background:#fafafa">${body}</body></html>`;

function sites() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url.startsWith('/csp')) {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'none'; script-src 'none'; img-src 'none'");
        return res.end(PAGE('Strict CSP page', '<h1>Very strict CSP</h1><p>No inline styles allowed here.</p>'));
      }
      if (req.url.startsWith('/other')) return res.end(PAGE('Somewhere else', '<h1>Another site</h1>'));
      res.end(PAGE('DBMS_Assignment', '<h1>DBMS Assignment 3</h1><label>Answer <input id="answer" autocomplete="off"></label><p>Q1. Normalise to 3NF…</p>'));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Mock helper backend: flags "zzflag" as a safety case, answers /offramp slowly, refuses the rest. */
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
        if (req.url === '/health') return res.end(JSON.stringify({ ok: true, llm: 'none', llm_location: 'none', embeddings: 'keyword', whisper: false, strategies: 58 }));
        if (req.url === '/sequence' && body.includes('zzflag')) {
          return res.end(
            JSON.stringify({
              mode: 'safety', lead: null, next_step: '', why_one_line: '', size: 'tiny', buttons: [], strategy_id: '', strategy_name: '',
              validation: null, suggest_rest: false, source: 'safety',
              safety: { crisis: true, message: 'I’m really glad you told me.', resources: [{ name: 'Tele-MANAS', phone: '14416' }] },
            }),
          );
        }
        if (req.url === '/sequence' && body.includes('zzrest')) {
          return res.end(
            JSON.stringify({
              mode: 'coach', lead: null, next_step: 'You’re allowed to rest. Your task will be saved for later.', why_one_line: 'Rest refills energy.', size: 'tiny',
              buttons: ['done', 'too_big', 'smaller', 'different', 'rest'], strategy_id: 'permission_to_rest', strategy_name: 'Permission to rest',
              validation: null, suggest_rest: true, source: 'card', safety: null,
            }),
          );
        }
        if (req.url === '/offramp') return setTimeout(() => res.end(JSON.stringify({ note_to_future_self: 'slow note', rest_suggestion: 'rest', source: 'card' })), 17000);
        res.statusCode = 503;
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const site = await sites();
  const backend = await mockBackend();
  const port = site.address().port;
  const bport = backend.address().port;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-edge-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 420, height: 860 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const errors = [];
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    await sleep(1000);
    for (const p of ctx.pages()) if (p.url().includes('onboarding.html')) await p.close();

    const task = await ctx.newPage();
    await task.goto(`http://127.0.0.1:${port}/task`);
    const panel = await ctx.newPage();
    panel.on('pageerror', (e) => errors.push(String(e)));
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    await panel.locator('h1').first().waitFor();

    // skip onboarding: onboarded, demo mode (no learning wait), task tab pinned, helper = mock
    const taskTabId = await panel.evaluate(async (port) => {
      const [t] = await chrome.tabs.query({ url: `http://127.0.0.1:${port}/*` });
      return t.id;
    }, port);
    const store = (keys) => panel.evaluate((k) => chrome.storage.local.get(k), keys);
    const sesStore = (keys) => panel.evaluate((k) => chrome.storage.session.get(k), keys);
    const patchSettings = (patch) =>
      panel.evaluate(async (patch) => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, ...patch } });
      }, patch);
    await patchSettings({ onboarded: true, demoMode: true, inputStyle: 'buttons', backendUrl: `http://127.0.0.1:${bport}`, taskTab: { tabId: taskTabId, host: '127.0.0.1', title: 'DBMS_Assignment' } });
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    const simulate = (sim) => panel.evaluate((sim) => chrome.runtime.sendMessage({ kind: 'simulate', sim }), sim);
    const overlayCount = () => task.evaluate(() => document.querySelectorAll('nudge-overlay').length);

    // ── 1. keyboard-only bubble, focus never stolen ──
    await task.bringToFront();
    await task.locator('#answer').click();
    await task.keyboard.type('abc');
    await simulate('stuck');
    await sleep(700);
    const focusKept = await task.evaluate(() => document.activeElement && document.activeElement.id === 'answer');
    check('bubble appears without stealing focus from the page', focusKept);
    await task.keyboard.type('d');
    check('typing keeps going into the page while the bubble is up', (await task.locator('#answer').inputValue()) === 'abcd');
    await task.screenshot({ path: path.join(outDir, '01-bubble.png') });
    // Tab order inside the bubble: [Minimise] [Close] [Help me start] [I need a break] [I'm fine]
    for (let i = 0; i < 5; i++) await task.keyboard.press('Tab');
    await task.keyboard.press('Enter');
    await sleep(500);
    let g = (await store('guard')).guard;
    check('bubble is reachable and usable by keyboard alone ("I\'m fine" via Tab+Enter)', g.dismissalsToday === 1, `dismissals=${g.dismissalsToday}, cooldown=${g.cooldownMin}`);
    check('"I\'m fine" doubles the quiet time', g.cooldownMin === 40);

    // Esc closes and counts as "I'm fine"; the third one shows the kind "off for today" note
    for (let n = 2; n <= 3; n++) {
      await simulate('stuck');
      await sleep(500);
      await task.locator('#answer').click();
      await task.keyboard.press('Tab');
      await task.keyboard.press('Escape');
      await sleep(600);
    }
    g = (await store('guard')).guard;
    check('Esc closes the bubble and Nudge backs off; 3 in a day = resting until tomorrow', g.dismissalsToday === 3 && g.offUntilTomorrow === true, JSON.stringify({ d: g.dismissalsToday, off: g.offUntilTomorrow }));
    await task.screenshot({ path: path.join(outDir, '02-off-for-today-note.png') });
    check('the kind note stays visible after closing', (await overlayCount()) === 1);

    // ── 2. tiny viewport ──
    await task.setViewportSize({ width: 320, height: 480 });
    await sleep(6500); // let the earlier "off for today" note fade on its own
    await simulate('restuck');
    await sleep(600);
    const rect = await task.evaluate(() => {
      const r = document.querySelector('nudge-overlay').getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    });
    check('on a 320px-wide screen the chip stays inside the viewport and leaves most of the page visible', rect.left >= 0 && rect.right <= 320 && rect.h < 480 * 0.6, JSON.stringify(rect));
    await task.screenshot({ path: path.join(outDir, '03-small-viewport.png') });
    await task.setViewportSize({ width: 420, height: 860 });

    // ── 3. double injection never doubles the overlay ──
    await sw.evaluate(async (tabId) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }, taskTabId);
    await task.reload();
    await sw.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), taskTabId);
    await simulate('stuck');
    await sleep(600);
    check('injected twice → still exactly one overlay host', (await overlayCount()) === 1);

    // ── 4. strict CSP page still gets styled overlays ──
    const csp = await ctx.newPage();
    await csp.goto(`http://127.0.0.1:${port}/csp`);
    await csp.bringToFront();
    await simulate('restuck');
    await sleep(700);
    const cspRect = await csp.evaluate(() => {
      const el = document.querySelector('nudge-overlay');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check('overlay renders (styled, ~300px wide) on a page with a very strict CSP', !!cspRect && cspRect.w >= 250 && cspRect.w <= 340, JSON.stringify(cspRect));
    await csp.screenshot({ path: path.join(outDir, '04-strict-csp.png') });
    await csp.close();

    // ── 5. pinned tab navigating to another site ──
    await task.bringToFront();
    await panel.evaluate(() => chrome.storage.session.set({ rawEvents: [] }));
    await task.goto(`http://localhost:${port}/other`);
    await sleep(800);
    const raw = (await sesStore('rawEvents')).rawEvents || [];
    const nav = raw.filter((e) => e.kind === 'activate' && e.host === 'localhost');
    check('navigating the pinned tab to another site is seen as leaving the task', nav.length > 0 && nav.every((e) => e.isTaskTab === false), JSON.stringify(nav.slice(-1)));
    const pinned = (await store('settings')).settings.taskTab;
    check('…and the pinned task keeps its own name', pinned.title === 'DBMS_Assignment' && pinned.host === '127.0.0.1', JSON.stringify(pinned));
    await task.goto(`http://127.0.0.1:${port}/task`);

    // ── 6. excluded sites produce no interaction counts ──
    await patchSettings({ excludedSites: ['127.0.0.1'] });
    await panel.evaluate(() => chrome.storage.session.set({ rawEvents: [] }));
    await task.bringToFront();
    await task.locator('#answer').click();
    await task.keyboard.type('hello there');
    await task.evaluate(() => window.scrollBy(0, 50));
    await sleep(11000); // content script flushes counts every 10 s
    const raw2 = (await sesStore('rawEvents')).rawEvents || [];
    check('excluded site: no key/scroll counts recorded', !raw2.some((e) => e.kind === 'interact'), `${raw2.length} events`);
    await patchSettings({ excludedSites: [] });

    // ── 7. worker stopped mid-break: break alarm and ticks still work, no duplicate nudges ──
    await panel.evaluate(async () => {
      await chrome.storage.local.set({ breakState: { startedAt: Date.now(), plannedMin: 1, returnPromptShown: false } });
      await chrome.alarms.create('nudge-break-end', { delayInMinutes: 0.5 });
      await chrome.action.setBadgeText({ text: '•' });
    });
    const guardBefore = (await store('guard')).guard;
    const featsBefore = ((await store('features')).features || []).length;
    const cdp = await ctx.newCDPSession(panel);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await sleep(1500);
    const alive = await panel.evaluate(() => chrome.runtime.sendMessage({ kind: 'panelHeartbeat' }).then(() => true, () => false));
    check('worker comes back after being stopped', alive);
    let badge = '•';
    for (let i = 0; i < 45 && badge; i++) {
      await sleep(1000);
      badge = await panel.evaluate(() => chrome.action.getBadgeText({}));
    }
    check('break-end alarm still fires after a worker restart', badge === '', `badge="${badge}"`);
    let featsAfter = featsBefore;
    for (let i = 0; i < 40 && featsAfter <= featsBefore; i++) {
      await sleep(1000);
      featsAfter = ((await store('features')).features || []).length;
    }
    check('30 s sensing ticks continue after the restart', featsAfter > featsBefore, `${featsBefore} → ${featsAfter}`);
    const guardAfter = (await store('guard')).guard;
    check('no extra nudge was fired by the restart', guardAfter.lastAutoNudgeAt === guardBefore.lastAutoNudgeAt);
    const bs = (await store('breakState')).breakState;
    check('break survives the restart', !!bs && bs.plannedMin === 1);
    await panel.evaluate(() => chrome.storage.local.set({ breakState: null }));

    // ── 8. safety flagged by the helper: the words are not kept anywhere ──
    await panel.bringToFront();
    await panel.reload();
    await panel.getByRole('heading', { name: "I'm stuck" }).waitFor();
    const winsBefore = ((await store('wins')).wins || []).length;
    await panel.getByLabel(/What is it/).fill('zzflag everything');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.getByText(/Tele-MANAS/).waitFor({ timeout: 30000 });
    const dump1 = JSON.stringify(await panel.evaluate(async () => [await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
    check('helper-flagged safety: the words are scrubbed from session and wins', !/zzflag/.test(dump1));
    check('…and the "started" win for it was removed', ((await store('wins')).wins || []).length === winsBefore);
    await panel.screenshot({ path: path.join(outDir, '05-safety-from-helper.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();

    // crisis inside a brain dump
    await panel.getByRole('button', { name: 'Brain dump' }).click();
    await panel.getByLabel('Everything on your mind').fill('laundry, email prof, honestly i want to kill myself');
    await panel.getByRole('button', { name: 'Sort it for me' }).click();
    await panel.getByText(/Tele-MANAS/).waitFor();
    const dump2 = JSON.stringify(await panel.evaluate(async () => [await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
    check('crisis inside a brain dump → support screen, nothing stored', !/kill myself|email prof/.test(dump2));
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();

    // ── 9. energy 1 + Too big → rest offered; empty input still gets a step ──
    await panel.getByRole('radio', { name: /1/ }).first().click().catch(() => undefined);
    await panel.getByLabel(/What is it/).fill('');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 30000 });
    check('empty input still gets a tiny step', (await panel.locator('.step-text').innerText()).length > 5);
    const beforeTooBig = await panel.locator('.step-text').innerText();
    await panel.getByRole('button', { name: /^Too much right now/ }).click();
    // wait for the *new* step, not the one still on screen
    await panel.waitForFunction((old) => {
      const el = document.querySelector('.step-text');
      return !!el && el.textContent !== old;
    }, beforeTooBig, { timeout: 15000 }).catch(() => undefined);
    await panel.locator('.step-text').waitFor();
    const restOffered = await panel.getByText(/Resting is a perfectly good choice|Resting is also a valid choice/).count();
    check('at the lowest energy "Too big" offers rest alongside a smaller step', restOffered > 0);
    const sess = (await store('session')).session;
    check('Too big lowered the energy to 1', sess && sess.energy === 1, String(sess && sess.energy));
    await panel.screenshot({ path: path.join(outDir, '06-too-big-energy-1.png'), fullPage: true });

    // ── 10. slow helper on "Done for today" → kind local note within the timeout ──
    await panel.getByRole('button', { name: /^I need rest/ }).click();
    const t0 = Date.now();
    await panel.getByRole('button', { name: 'Done for today' }).click();
    await panel.getByText('Note to future-you').waitFor({ timeout: 25000 });
    const took = Math.round((Date.now() - t0) / 1000);
    const noteText = await panel.locator('#note-h + p').innerText();
    check('slow helper → a local note to future-you after the timeout', /future-me/i.test(noteText) && took <= 20, `${took}s: ${noteText.slice(0, 60)}`);
    check('Done for today pauses auto-nudges until the next session', (await store('guard')).guard.dayClosed === true);
    await panel.screenshot({ path: path.join(outDir, '07-day-closed.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Back to start' }).click();

    // ── 11. accessibility settings apply live and persist ──
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByRole('heading', { name: 'Settings' }).waitFor();
    await patchSettings({ a11y: { font: 'dyslexic', textScale: 1.3, highContrast: true, reducedMotion: 'on' } });
    await sleep(400);
    const attrs = () => panel.evaluate(() => ({ ...document.documentElement.dataset, scale: document.documentElement.style.getPropertyValue('--n-text-scale') }));
    let a = await attrs();
    check('dyslexia font, high contrast, reduced motion and text size apply live', a.font === 'dyslexic' && a.contrast === 'high' && a.motion === 'off' && a.scale === '1.3', JSON.stringify(a));
    await panel.reload();
    await sleep(800);
    a = await attrs();
    check('…and persist across reloads', a.font === 'dyslexic' && a.contrast === 'high', JSON.stringify(a));
    const anims = await panel.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--n-motion').trim());
    check('reduced motion zeroes animation timing', anims === '0', anims);
    await panel.screenshot({ path: path.join(outDir, '08-a11y-settings.png'), fullPage: true });
    // reduced motion + high contrast reach in-page overlays too
    await task.bringToFront();
    await simulate('restuck');
    await sleep(600);
    await task.screenshot({ path: path.join(outDir, '09-overlay-high-contrast.png') });
    await patchSettings({ a11y: { font: 'default', textScale: 1, highContrast: false, reducedMotion: 'system' } });

    // ── 12. backend URL: invalid, scheme-less, and non-local ──
    await panel.bringToFront();
    await panel.getByRole('button', { name: 'Settings' }).click().catch(() => undefined);
    await panel.getByRole('heading', { name: 'Settings' }).waitFor();
    const field = panel.getByLabel('Nudge helper address');
    const save = field.locator('xpath=following-sibling::button');
    await field.fill('not a url ::');
    await save.click();
    check('an invalid helper address is refused gently', (await panel.getByText(/doesn’t look like a web address/).count()) > 0);
    await field.fill('localhost:8000');
    await save.click();
    await sleep(300);
    check('"localhost:8000" is understood as http://localhost:8000', (await store('settings')).settings.backendUrl === 'http://localhost:8000');
    await field.fill('https://example.com');
    await save.click();
    await sleep(300);
    check('a helper that is not on this computer gets an honest note', (await panel.getByText(/isn’t on your computer/).count()) > 0);
    await panel.screenshot({ path: path.join(outDir, '10-backend-url-note.png'), fullPage: true });
    await field.fill(`http://127.0.0.1:${bport}`);
    await save.click();

    // ── 13. region decides the support lines ──
    await panel.getByLabel('Region for support lines').selectOption('UK');
    await sleep(300);
    await panel.getByRole('button', { name: 'Demo mode' }).click();
    await panel.getByRole('button', { name: 'Simulate crisis phrase' }).click();
    check('region UK → Samaritans 116 123', (await panel.getByText('116 123').count()) > 0);
    await panel.getByRole('button', { name: 'Back to Nudge' }).click();
    await panel.getByRole('button', { name: 'Settings' }).click();
    await panel.getByLabel('Region for support lines').selectOption('IN');

    // ── 15. "Help me start" in the page starts a step straight away ──
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.evaluate(() => chrome.storage.session.set({ panelIntent: { screen: 'stuck', state: 'stuck', t: Date.now() } }));
    await panel.locator('.step-text').waitFor({ timeout: 30000 });
    check('bubble "Help me start" opens straight onto a first step (no second tap)', true);

    // ── 16. "Stuck again" never repeats the step that stalled ──
    const stalled = (await panel.locator('.step-text').innerText()).trim();
    await panel.evaluate(() => chrome.storage.session.set({ panelIntent: { screen: 'resume', t: Date.now() } }));
    await panel.waitForFunction((old) => {
      const el = document.querySelector('.step-text');
      return el && el.textContent.trim() !== old;
    }, stalled, { timeout: 30000 }).catch(() => undefined);
    const resumed = (await panel.locator('.step-text').innerText()).trim();
    check('"Stuck again" offers a different step, never the same one', resumed !== stalled, resumed.slice(0, 60));
    check('…and never mentions the stall', !/stall|again you|didn.t finish|abandon/i.test(await panel.locator('main').innerText()));

    // ── 17. rest cards rest instead of "Done" ──
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.getByRole('button', { name: 'Welcome back' }).count(); // no-op
    await panel.getByLabel(/What is it/).fill('zzrest');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.locator('.step-text').waitFor({ timeout: 30000 });
    check('a rest card offers "Rest now" (not "Done")', (await panel.getByRole('button', { name: /^Rest now/ }).count()) === 1 && (await panel.getByRole('button', { name: /^Done/ }).count()) === 0);
    await panel.screenshot({ path: path.join(outDir, '11-rest-card.png'), fullPage: true });
    await panel.getByRole('button', { name: /^Rest now/ }).click();
    const restShown = await panel.getByRole('button', { name: '5 min', exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false);
    check('…which leads to the rest choices', restShown);

    // ── 18. "concern" level: I'm safe, just frustrated; copy the number ──
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.getByLabel(/What is it/).fill('I feel so hopeless about this');
    await panel.getByRole('button', { name: 'Help me start', exact: true }).click();
    await panel.getByText(/Tele-MANAS/).waitFor();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${id}` }).catch(() => undefined);
    await panel.bringToFront();
    await panel.getByRole('button', { name: /Copy Tele-MANAS number/ }).click();
    const copiedOk = await panel.getByRole('button', { name: /Copy Tele-MANAS number/ }).filter({ hasText: 'Copied' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
    const clip = await panel.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
    // headless Chromium can't read the system clipboard back, so a successful copy is confirmed by the UI
    check('support numbers can be copied (desktop often ignores tel: links)', copiedOk && (clip === '' || clip === '14416'), `shown=${copiedOk} clipboard="${clip || 'unreadable headless'}"`);
    await panel.screenshot({ path: path.join(outDir, '12-safety-concern.png'), fullPage: true });
    await panel.getByRole('button', { name: /I’m safe — just really frustrated/ }).click();
    await panel.getByRole('button', { name: 'Take a break' }).waitFor();
    check('"I’m safe — just really frustrated" → validation and a rest offer', (await panel.getByText(/Thank you for telling me/).count()) === 1);
    await panel.screenshot({ path: path.join(outDir, '13-frustrated.png'), fullPage: true });
    const dump3 = JSON.stringify(await panel.evaluate(async () => [await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
    check('…and the hopeless sentence was not stored', !/hopeless about this/.test(dump3));
    await panel.getByRole('button', { name: 'Back to start' }).click();

    // ── 19. brain dump: one pick first, everything else tucked away ──
    await panel.getByRole('button', { name: 'Brain dump' }).click();
    await panel.getByLabel('Everything on your mind').fill("I have the DBMS assignment due tomorrow, haven't started the OS lab report, honestly it's too much, mum keeps calling, need to email prof, and the laundry is piling up, also pay mess fees, book a doctor appointment");
    await panel.getByRole('button', { name: 'Sort it for me' }).click();
    await panel.getByText('Just one to start with:').waitFor({ timeout: 30000 });
    const swaps = await panel.locator('.chips .chip-btn').count();
    const heard = await panel.getByText(/See everything I heard \(\d+\)/).count();
    check('brain dump shows one pick, ≤3 swaps, the rest tucked behind "See everything I heard"', swaps <= 3 && heard === 1, `swaps=${swaps}`);
    check('…the feeling is validated, not listed as a task', (await panel.getByText(/a lot to hold/).count()) === 1 && !(await panel.locator('details').innerText()).match(/too much/i));
    check('…and "Rest instead" is right there', (await panel.getByRole('button', { name: 'Rest instead' }).count()) === 1);
    await panel.screenshot({ path: path.join(outDir, '14-brain-dump.png'), fullPage: true });

    // ── 20. a break from days ago → welcome back, not a stale timer ──
    await panel.evaluate(() => chrome.storage.local.set({ breakState: { startedAt: Date.now() - 3 * 86_400_000, plannedMin: 15, returnPromptShown: false } }));
    await panel.reload();
    await panel.getByText(/Welcome back/).waitFor({ timeout: 10000 }).catch(() => undefined);
    check('an old break opens on "Welcome back", not the break timer', (await panel.getByText(/Welcome back/).count()) > 0 && (await panel.getByText(/Break’s done/).count()) === 0);
    check('…and the stale break is cleared', (await store('breakState')).breakState === null);
    await panel.screenshot({ path: path.join(outDir, '15-welcome-after-days.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Start fresh' }).click();

    // ── 21. fonts really load; literal energy uses plain numbers ──
    const fonts = await panel.evaluate(async () => {
      await document.fonts.ready;
      return { atkinson: document.fonts.check('16px "Atkinson Hyperlegible"'), body: getComputedStyle(document.body).fontFamily };
    });
    check('Atkinson Hyperlegible actually applies to the panel body', fonts.atkinson && /Atkinson/.test(fonts.body), JSON.stringify(fonts));
    await patchSettings({ a11y: { font: 'dyslexic', textScale: 1, highContrast: false, reducedMotion: 'system' } });
    await sleep(400);
    const lexend = await panel.evaluate(async () => {
      await document.fonts.load('16px "Lexend"');
      return { ok: document.fonts.check('16px "Lexend"'), body: getComputedStyle(document.body).fontFamily };
    });
    check('dyslexia-friendly Lexend loads and applies', lexend.ok && /Lexend/.test(lexend.body), JSON.stringify(lexend));
    await patchSettings({ a11y: { font: 'default', textScale: 1, highContrast: false, reducedMotion: 'system' }, wordingStyle: 'literal' });
    await sleep(400);
    check('literal mode: energy shows plain numbers, no metaphors', (await panel.getByRole('radio', { name: '1 — Very low energy' }).count()) === 1 && !(await panel.locator('.energy').innerText()).includes('🥄'));
    await panel.screenshot({ path: path.join(outDir, '16-literal-home.png'), fullPage: true });
    // arrow keys move through the energy radios
    await panel.getByRole('radio', { checked: true }).first().focus();
    const beforeE = await panel.getByRole('radio', { checked: true }).first().getAttribute('aria-label');
    await panel.keyboard.press('ArrowRight');
    await sleep(200);
    const afterE = await panel.evaluate(() => document.activeElement.getAttribute('aria-label'));
    check('arrow keys move between energy options', beforeE !== afterE && /energy/.test(afterE || ''), `${beforeE} → ${afterE}`);
    await patchSettings({ wordingStyle: 'warm' });

    // ── 22. Tab only ever lands on real controls ──
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    await panel.locator('body').click({ position: { x: 2, y: 2 } });
    const stops = [];
    for (let i = 0; i < 25; i++) {
      await panel.keyboard.press('Tab');
      stops.push(await panel.evaluate(() => {
        const el = document.activeElement;
        return el ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}` : 'none';
      }));
    }
    const stray = stops.filter((t) => !/^(button|a|input|select|textarea|summary|body)/.test(t));
    check('no stray tab stops on the panel', stray.length === 0, stray.join(', '));

    // ── 14. every control has a name and a comfortable size ──
    await panel.getByRole('button', { name: 'Nudge home' }).click();
    const audit = await panel.evaluate(() => {
      const unnamed = [];
      const small = [];
      document.querySelectorAll('button, a[href], input, select, textarea').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const name = el.getAttribute('aria-label') || el.textContent.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent;
        if (!name || !name.trim()) unnamed.push(el.outerHTML.slice(0, 80));
        if (el.type !== 'checkbox' && el.type !== 'radio' && !el.classList.contains('link') && r.height < 44) small.push(`${el.tagName} "${(name || '').trim().slice(0, 24)}" ${Math.round(r.height)}px`);
      });
      return { unnamed, small };
    });
    check('every control on Home has an accessible name', audit.unnamed.length === 0, audit.unnamed.join(' | '));
    check('every Home control is at least 44px tall', audit.small.length === 0, audit.small.join(' | '));

    check('no page errors in the panel', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('edge flow', false, String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : e));
  } finally {
    await ctx.close();
    site.close();
    backend.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} edge checks passed. Screenshots: ${outDir}`);
  process.exit(failed.length ? 1 : 0);
})();
