#!/usr/bin/env node
// Recording check in the real app: start the app with the fake capture so the
// click track plays through the capture path silently,
//   SONORA_FAKE_CAPTURE=$PWD/test-audio/click-120.wav bash scripts/app/dev.sh
// then this records the visual with the sync probe on, measures frame pacing
// (held frames) and the capture's frame cost with recording off and on, stops,
// and runs scripts/av-sync.py on the file.
//   node scripts/app/rec-check.mjs [--secs 20] [--style ink] [--preset output|1080] [--fps 60] [--outro]
import { execFileSync } from 'node:child_process';
import { connectApp } from './cdp.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const secs = Number(arg('secs', 20));
const { page } = await connectApp();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
await page.reload();
await page.waitForFunction(() => !!window.__sonoraHooks?.shell, null, { timeout: 60000 });
const pacing = (seconds) => page.evaluate(async (s) => {
  const r = window.__sonoraHooks.renderer;
  const per = [];
  for (let i = 0; i < s; i++) { await new Promise((res) => setTimeout(res, 1000)); per.push(r.pacing()); }
  return { held: per.reduce((a, p) => a + p.held, 0), fps: per.reduce((a, p) => a + p.fps, 0) / per.length, worst: Math.max(...per.map((p) => p.worstMs)), hz: per[per.length - 1].displayHz };
}, seconds);
await page.evaluate(async (style) => {
  const H = window.__sonoraHooks;
  H.setDebugFlags({ syncFlash: true });
  H.shell.goVisual();
  await new Promise((r) => setTimeout(r, 1500));
}, arg('style', 'ink'));
const base = await pacing(8);
console.log(`pacing, recording off: ${base.fps.toFixed(1)} fps on a ${base.hz.toFixed(0)} Hz display · held ${base.held} · worst ${base.worst.toFixed(1)} ms`);
const res = await page.evaluate(async (o) => {
  const H = window.__sonoraHooks;
  const rec = H.platform.recorder;
  // Long frames (> 30 ms) with their time from the recording's start.
  window.__gaps = []; window.__t0 = performance.now(); let last = performance.now();
  H.renderer.addFrameHook((_g, now) => { if (now - last > 30) window.__gaps.push([Math.round(now - window.__t0), Math.round(now - last)]); last = now; });
  await rec.start({ preset: o.preset, fps: o.fps, corner: 'br', outro: o.outro });
  return rec.status();
}, { preset: arg('preset', 'output'), fps: Number(arg('fps', 60)), outro: process.argv.includes('--outro') });
console.log(`recording ${res.size.join('×')} → ${res.path}`);
const during = await pacing(Math.max(4, secs - 2));
const cost = await page.evaluate(() => window.__sonoraHooks.platform.recorder.costMs());
console.log('long frames (ms from start, length):', JSON.stringify(await page.evaluate(() => window.__gaps)));
console.log(`pacing, recording on:  ${during.fps.toFixed(1)} fps · held ${during.held} · worst ${during.worst.toFixed(1)} ms · capture ${cost.toFixed(3)} ms per recorded frame`);
const out = await page.evaluate(async () => {
  const H = window.__sonoraHooks;
  const r = await H.platform.recorder.stop();
  H.setDebugFlags({ syncFlash: false });
  return r;
});
console.log(`saved ${(out.bytes / 1048576).toFixed(1)} MB · ${out.seconds.toFixed(1)} s · ${out.frames} frames · ring drops ${out.dropped}${out.error ? ` · error ${out.error}` : ''}`);
console.log(execFileSync('python', ['scripts/av-sync.py', out.path], { encoding: 'utf8' }).trim());
process.exit(0);
