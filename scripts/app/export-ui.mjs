#!/usr/bin/env node
// Export screen screenshots in the running desktop app: opens it, loads a song
// through the file picker, and screenshots the states (9:16 with safe zones,
// 16:9, a tour, text lines) at the given window size → verify/export/.
//   node scripts/app/export-ui.mjs <song file> [--size 1920x1080]
import { mkdirSync } from 'node:fs';
import { connectApp } from './cdp.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2];
const [W, H] = arg('size', '1920x1080').split('x').map(Number);
mkdirSync('verify/export', { recursive: true });
const { page } = await connectApp();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
const s = await page.context().newCDPSession(page);
await s.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
if (!(await page.$('.scr-export:not([hidden])'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); await page.keyboard.press('e'); }
await page.waitForSelector('.scr-export:not([hidden])');
await page.setInputFiles('.scr-export input[type=file]', file);
await page.waitForFunction(() => !!document.querySelector('.scr-export .ex-song'), null, { timeout: 120000 });
await page.waitForTimeout(1500);
const tag = `${W}x${H}`;
await page.screenshot({ path: `verify/export/screen-song-${tag}.png` });
const click = async (text, scope = '.scr-export') => { const b = page.locator(`${scope} button`, { hasText: new RegExp(`^${text}$`, 'i') }).first(); await b.scrollIntoViewIfNeeded(); await b.click(); await page.waitForTimeout(500); };
await click('9:16');
await page.waitForTimeout(800);
await page.screenshot({ path: `verify/export/screen-916-${tag}.png` });
await click('Preview');
await page.waitForTimeout(6000);
await page.screenshot({ path: `verify/export/screen-916-playing-${tag}.png` });
await click('Stop');
await click('16:9');
await click('styles tour');
await click('Add a line');
await page.fill('.scr-export textarea.ex-text', 'first time hearing this live');
await page.waitForTimeout(600);
await page.screenshot({ path: `verify/export/screen-tour-text-${tag}.png` });
process.exit(0);
