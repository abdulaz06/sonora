#!/usr/bin/env node
// /live regression test: clicks every style, look, view and palette in the app
// UI the page runs (menu → style detail → Start, and the quick switcher), plus
// custom hue, colour drift, Set Mode, fullscreen and the settings sheet, and
// asserts the engine itself switched (renderer + colour engine state), for each
// audio source (the demo, a dropped file, the microphone through a fake device).
// Also asserts the detail screen's Start button is visible and on top: the
// landing stylesheet once leaked into /live and hid it (DECISIONS D81).
//
//   node scripts/test-live.mjs [--base URL] [--channel msedge|chrome|chromium] [--headed] [--sources demo,file,mic] [--swiftshader] [--slow]
// CI: --channel chromium (Playwright's, software WebGL via SwiftShader) --slow.
// Default base: a local `astro preview` on :4321 (started if needed).
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// ── Tuning ──────────────────────────────────────────────────────
/** How long a switch may take (software WebGL in CI compiles Voyage slowly: --slow). */
const SWITCH_TIMEOUT_MS = process.argv.includes('--slow') ? 45000 : 8000;
const STEP_PAUSE_MS = 250;

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:4321');
const CHANNEL = arg('channel', 'msedge');
const HEADED = process.argv.includes('--headed');
const SOURCES = arg('sources', 'demo,file,mic').split(',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0, passes = 0;
const check = (ok, what, detail = '') => {
  if (ok) passes++; else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
};

// A local preview, if the base is local and nothing answers yet.
let server = null;
const up = async () => { try { return (await fetch(`${BASE}/live`)).ok; } catch { return false; } };
if (/localhost|127\.0\.0\.1/.test(BASE) && !(await up())) {
  server = spawn('npx', ['astro', 'preview', '--port', new URL(BASE).port || '4321'], { cwd: SITE, shell: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  for (let i = 0; i < 60 && !(await up()); i++) await wait(500);
}
const stopServer = () => {
  if (!server) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-server.pid, 'SIGTERM');
  } catch { /* gone */ }
};

const args = ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--window-size=1440,960'];
if (CHANNEL === 'chromium' || process.argv.includes('--swiftshader')) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
else args.push('--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist');
const browser = await chromium.launch({ ...(CHANNEL === 'chromium' ? {} : { channel: CHANNEL }), headless: !HEADED, args });

/** Engine state, read from the renderer and colour engine (not the UI). */
const engine = (p) => p.evaluate(() => {
  const l = window.__live;
  const r = l.renderer;
  return {
    screen: l.shell.screen(), style: r.getStyle(), variant: r.getVariant(), depth: r.getDepth(),
    palette: r.colorEngine.paletteIndex, drift: r.colorEngine.driftEnabled, hue: l.controller.settings.customHue,
    setMode: l.controller.settings.setMode.on, fullscreen: !!document.fullscreenElement,
  };
});
async function until(p, pred, timeout = SWITCH_TIMEOUT_MS) {
  const t0 = Date.now();
  let s = await engine(p);
  while (!pred(s) && Date.now() - t0 < timeout) { await wait(120); s = await engine(p); }
  return s;
}
/** The element is on screen and is what a click at its centre hits. */
const reachable = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return { ok: false, why: `off screen ${JSON.stringify([r.left, r.top, r.width, r.height].map(Math.round))}` };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!hit && (el === hit || el.contains(hit)), why: hit ? `covered by <${hit.tagName.toLowerCase()} class="${String(hit.className).slice(0, 60)}">` : 'nothing at its centre' };
});
/** Poll an async predicate until true or the switch timeout. */
async function poll(fn, timeout = SWITCH_TIMEOUT_MS) {
  const t0 = Date.now();
  let ok = await fn();
  while (!ok && Date.now() - t0 < timeout) { await wait(150); ok = await fn(); }
  return ok;
}
const wake = async (p) => { await p.mouse.move(700, 500); await p.mouse.move(720, 520); await wait(150); };

async function startSource(p, source) {
  if (source === 'demo') await p.click('[data-src="demo"]');
  else if (source === 'mic') await p.click('[data-src="mic"]');
  else if (source === 'file') {
    // A real drop on the page (the same path as dragging a file from the desktop).
    await p.evaluate(async () => {
      const probe = document.createElement('audio');
      const url = probe.canPlayType('audio/webm; codecs="opus"') ? '/demo/demo.webm' : '/demo/demo.m4a';
      const blob = await fetch(url).then((r) => r.blob());
      const dt = new DataTransfer();
      dt.items.add(new File([blob], url.endsWith('webm') ? 'dropped-song.webm' : 'dropped-song.m4a', { type: blob.type }));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
  }
  const s = await until(p, (x) => x.screen === 'visual', 20000);
  const status = await p.evaluate(() => window.__live.source.currentStatus);
  check(s.screen === 'visual' && (status.state === 'live' || status.state === 'quiet'), `${source}: source starts and the visual shows`, `${status.kind} ${status.state} "${status.label}"`);
}

async function toMenu(p) {
  for (let i = 0; i < 3 && (await engine(p)).screen !== 'menu'; i++) { await p.keyboard.press('Escape'); await wait(700); }
  return (await engine(p)).screen === 'menu';
}

/** Every style, and every look × view of it, through menu → detail → Start. */
async function stylesViaDetail(p, source) {
  const count = await p.locator('.scr-menu .scard').count();
  check(count === 5, `${source}: menu shows five styles`, `${count}`);
  for (let i = 0; i < count; i++) {
    if (!(await toMenu(p))) { check(false, `${source}: back to the menu`); return; }
    const card = p.locator('.scr-menu .scard').nth(i);
    await card.click();
    await until(p, (x) => x.screen === 'detail');
    const detail = p.locator('.scr-detail');
    const name = (await detail.locator('.nm').textContent())?.trim() ?? '?';
    const style = name;
    const stageBox = await detail.locator('.stage').boundingBox();
    check(!!stageBox && stageBox.width < 0.8 * 1440, `${source}: ${style} detail preview leaves room for the controls`, stageBox ? `preview ${Math.round(stageBox.width)} px wide` : 'no preview');
    const start = detail.getByRole('button', { name: /start/i });
    const reach = await reachable(start);
    check(reach.ok, `${source}: ${style} detail Start button visible and on top`, reach.ok ? '' : reach.why);
    const groups = detail.locator('.grp');
    const labels = await groups.evaluateAll((gs) => gs.map((g) => g.querySelector('.s-label')?.textContent?.trim()));
    const lookGrp = labels.indexOf('look'), viewGrp = labels.indexOf('view');
    const looks = lookGrp >= 0 ? await groups.nth(lookGrp).locator('.s-thumb .s-thumb-title').allTextContents() : [null];
    const views = viewGrp >= 0 ? await groups.nth(viewGrp).locator('.s-thumb .s-thumb-title').allTextContents() : [null];
    const combos = [];
    for (const look of looks) for (const view of views) {
      // Wisp's looks are Depth-only: Flat is one combination.
      if (style === 'wisp' && view === 'Flat' && look !== looks[0]) continue;
      combos.push([look, view]);
    }
    for (const [k, [look, view]] of combos.entries()) {
      if (k > 0) {
        if (!(await toMenu(p))) { check(false, `${source}: back to the menu`); return; }
        await p.locator('.scr-menu .scard').nth(i).click();
        await until(p, (x) => x.screen === 'detail');
      }
      if (look) {
        const t = groups.nth(lookGrp).locator('.s-thumb', { hasText: look });
        const r = await reachable(t);
        check(r.ok, `${source}: ${style} look "${look}" clickable`, r.ok ? '' : r.why);
        await t.click();
      }
      if (view) {
        const t = groups.nth(viewGrp).locator('.s-thumb', { hasText: view });
        const r = await reachable(t);
        check(r.ok, `${source}: ${style} view "${view}" clickable`, r.ok ? '' : r.why);
        await t.click();
      }
      await wait(STEP_PAUSE_MS);
      await detail.getByRole('button', { name: /start/i }).click();
      const wantVariant = look && !(style === 'wisp' && view === 'Flat') ? look.toLowerCase() : null;
      const wantDepth = view ? view === 'Depth' : null;
      const s = await until(p, (x) => x.screen === 'visual' && x.style === style && (!wantVariant || x.variant === wantVariant) && (wantDepth === null || x.depth === wantDepth));
      check(s.style === style && (!wantVariant || s.variant === wantVariant) && (wantDepth === null || s.depth === wantDepth),
        `${source}: engine switched to ${[style, look, view].filter(Boolean).join(' · ').toLowerCase()}`, `engine: ${s.style} ${s.variant} ${s.depth ? 'depth' : 'flat'}`);
    }
  }
}

/** Looks, views and palettes in the visual's quick switcher. */
async function quickSwitcher(p, source) {
  const open = async () => {
    await wake(p);
    if (!(await p.locator('.qs.open').count())) await p.locator('.hud-bar .now').click();
    await p.locator('.qs.open').waitFor({ timeout: 4000 });
  };
  // Ink has looks and views; go there through the menu first.
  await toMenu(p);
  await p.locator('.scr-menu .scard').nth(0).click();
  await until(p, (x) => x.screen === 'detail');
  await p.locator('.scr-detail').getByRole('button', { name: /start/i }).click();
  await until(p, (x) => x.screen === 'visual' && x.style === 'ink');
  await open();
  const grpTitles = await p.locator('.qs .qs-grp').evaluateAll((gs) => gs.map((g) => g.querySelector('.s-label')?.textContent?.trim()));
  for (const [gi, title] of grpTitles.entries()) {
    const n = await p.locator('.qs .qs-grp').nth(gi).locator('.s-thumb').count();
    for (let k = 0; k < n; k++) {
      await open();
      const t = p.locator('.qs .qs-grp').nth(gi).locator('.s-thumb').nth(k);
      const label = (await t.locator('.s-thumb-title').textContent())?.trim() ?? '';
      // Palettes are titled "1 Ocean" … "9 Acid"; other tiles in that row (an Album tile) aren't presets.
      const preset = title === 'palette' ? /^(\d)\s/.exec(label) : null;
      if (title === 'palette' && !preset) continue;
      const r = await reachable(t);
      check(r.ok, `${source}: quick switcher ${title} "${label}" clickable`, r.ok ? '' : r.why);
      await t.click();
      let s;
      if (title === 'look') s = await until(p, (x) => x.variant === label.toLowerCase());
      else if (title === 'view') s = await until(p, (x) => x.depth === (label === 'Depth'));
      else s = await until(p, (x) => x.palette === Number(preset[1]) - 1);
      const ok = title === 'look' ? s.variant === label.toLowerCase() : title === 'view' ? s.depth === (label === 'Depth') : s.palette === Number(preset[1]) - 1;
      check(ok, `${source}: engine took ${title} "${label}"`, `engine: ${s.variant} ${s.depth ? 'depth' : 'flat'} palette ${s.palette}`);
    }
  }
  await p.keyboard.press('Escape').catch(() => undefined);
}

/** Custom hue, colour drift, Set Mode, fullscreen and the settings sheet. */
async function otherControls(p, source) {
  await toMenu(p);
  await p.locator('.scr-menu .scard').nth(0).click();
  await until(p, (x) => x.screen === 'detail');
  await p.locator('.scr-detail').getByRole('button', { name: /start/i }).click();
  await until(p, (x) => x.screen === 'visual');
  // Set Mode (HUD button): on, the engine changes what it shows; then off.
  await wake(p);
  const before = await engine(p);
  const sm = p.locator('.hud-bar button[title^="Set Mode"]');
  check((await reachable(sm)).ok, `${source}: Set Mode button clickable`);
  await sm.click();
  let s = await until(p, (x) => x.setMode && (x.style !== before.style || x.variant !== before.variant || x.depth !== before.depth));
  check(s.setMode && (s.style !== before.style || s.variant !== before.variant || s.depth !== before.depth), `${source}: Set Mode on and it switched the visual`, `${before.style}/${before.variant} → ${s.style}/${s.variant}`);
  await wake(p);
  await sm.click();
  s = await until(p, (x) => !x.setMode);
  check(!s.setMode, `${source}: Set Mode off`);
  // Fullscreen.
  await wake(p);
  const fs = p.locator('.hud-bar button[title^="Fullscreen"]');
  // Set Mode's toast and crossfade may still be on screen: wait until the button is what a click hits.
  let fsReach = { ok: false, why: '' };
  await poll(async () => { await wake(p); fsReach = await reachable(fs); return fsReach.ok; });
  check(fsReach.ok, `${source}: fullscreen button clickable`, fsReach.ok ? '' : fsReach.why);
  await fs.click();
  s = await until(p, (x) => x.fullscreen);
  check(s.fullscreen, `${source}: fullscreen on`);
  await wake(p);
  await fs.click();
  s = await until(p, (x) => !x.fullscreen);
  check(!s.fullscreen, `${source}: fullscreen off`);
  // Settings: opens, every section reachable from its nav.
  await wake(p);
  await p.locator('.hud-bar button[title="Settings"]').click();
  const sheet = p.locator('.s-sheet');
  await sheet.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
  check(await sheet.isVisible(), `${source}: settings open`);
  const navs = await p.locator('.st-nav button').allTextContents();
  for (const n of navs) {
    await p.locator('.st-nav button', { hasText: n }).first().click();
    const inView = await poll(() => p.evaluate((id) => {
      const secs = [...document.querySelectorAll('.s-sheet .st-sec')];
      const sec = secs.find((x) => x.querySelector('.st-sec-head .s-h2')?.textContent?.trim() === id);
      if (!sec) return false;
      const r = sec.getBoundingClientRect(), b = document.querySelector('.s-sheet').getBoundingClientRect();
      return r.top < b.bottom && r.bottom > b.top;
    }, n.trim()));
    check(inView, `${source}: settings section "${n.trim()}" reachable`);
  }
  // Colour: Custom palette, then the hue slider (a real drag on the track).
  await p.locator('.st-nav button', { hasText: 'colour' }).click();
  await wait(450);
  await p.locator('.s-sheet .pal-thumb', { hasText: 'Custom' }).click();
  s = await until(p, (x) => x.palette === -1);
  check(s.palette === -1, `${source}: custom colour chosen`);
  const hue = p.locator('.s-sheet .s-slider--hue input[type=range]');
  await hue.waitFor({ timeout: 4000 });
  await hue.scrollIntoViewIfNeeded();
  await wait(300);
  const box = await hue.boundingBox();
  const hueBefore = (await engine(p)).hue;
  const at = { x: box.x + box.width * 0.2, y: box.y + box.height / 2 };
  const target = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}` : 'none'; }, at);
  await p.mouse.click(at.x, at.y);
  s = await until(p, (x) => x.hue !== hueBefore && Math.abs(x.hue - 72) < 25);
  check(s.hue !== hueBefore && Math.abs(s.hue - 72) < 25, `${source}: custom hue follows the slider`, `${hueBefore}° → ${s.hue}° (clicked ${target} at ${Math.round(at.x)},${Math.round(at.y)})`);
  // The engine crossfades to the new palette over its own frames; wait for it to land near the hue.
  const near = (h) => Math.abs(((h - s.hue + 540) % 360) - 180) < 80;
  let prim = 0;
  await poll(async () => { prim = await p.evaluate(() => window.__live.renderer.colorEngine.getPalette().primary[2]); return near(prim); });
  check(near(prim), `${source}: engine palette built around the hue`, `primary hue ${prim.toFixed(0)}°`);
  // Colour drift on and off.
  const drift = p.locator('.s-sheet .st-row', { hasText: 'Colour drift' }).locator('label.s-toggle');
  await drift.click();
  s = await until(p, (x) => x.drift);
  check(s.drift, `${source}: colour drift on`);
  await p.locator('.s-sheet .st-row', { hasText: 'Colour drift' }).locator('label.s-toggle').click();
  s = await until(p, (x) => !x.drift);
  check(!s.drift, `${source}: colour drift off`);
  // A preset again, from the sheet.
  await p.locator('.s-sheet .pal-thumb', { hasText: 'Aurora' }).click();
  s = await until(p, (x) => x.palette === 1);
  check(s.palette === 1, `${source}: preset palette from settings`);
  await p.keyboard.press('Escape');
}

try {
  for (const source of SOURCES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: source === 'mic' ? ['microphone'] : [] });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/live`);
    await p.waitForFunction(() => window.__live, null, { timeout: 30000 });
    await p.evaluate(() => localStorage.clear());
    await startSource(p, source);
    await stylesViaDetail(p, source);
    await quickSwitcher(p, source);
    await otherControls(p, source);
    check(errors.length === 0, `${source}: no page errors`, errors.join(' | '));
    await ctx.close();
  }
} catch (e) {
  check(false, 'test run', e.message.split('\n')[0]);
} finally {
  await browser.close();
  stopServer();
}
console.log(`\n${passes} passed, ${failures} failed (${CHANNEL}${HEADED ? ', headed' : ''}, ${BASE})`);
process.exit(failures ? 1 : 0);
