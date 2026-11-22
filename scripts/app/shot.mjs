#!/usr/bin/env node
// Screenshot the running desktop app's main window (see scripts/app/cdp.mjs):
//   node scripts/app/shot.mjs <out.png> [--key e] [--eval "<js>"] [--wait ms] [--size 1920x1080]
import { connectApp } from './cdp.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = process.argv[2];
const { page } = await connectApp();
const size = arg('size');
if (size) { const [w, h] = size.split('x').map(Number); const s = await page.context().newCDPSession(page); await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
const key = arg('key'); if (key) await page.keyboard.press(key);
const ev = arg('eval'); if (ev) console.log(await page.evaluate(ev));
await page.waitForTimeout(Number(arg('wait', 800)));
if (out) await page.screenshot({ path: out });
process.exit(0);
