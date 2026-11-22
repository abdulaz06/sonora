#!/usr/bin/env node
// Export check in the real app (WebView2 + Rust): renders a clip of a test
// track through the Export pipeline (hardware H.264, Windows AAC) into
// Videos\sonora and reports render speed, file size and the encoder; with
// --twice it renders the same plan again and compares the frame hashes
// (determinism). Start the app first (see scripts/app/cdp.mjs).
//
//   node scripts/app/export-check.mjs [--track house-124] [--combo ink-glow-depth] [--start 40] [--secs 10]
//        [--size 1920x1080] [--fps 60] [--ss 1] [--format song] [--twice] [--outro] [--name check]
import { connectApp } from './cdp.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const opts = {
  track: arg('track', 'house-124'), combo: arg('combo', 'ink-glow-depth'), start: Number(arg('start', 40)), secs: Number(arg('secs', 10)),
  size: arg('size', '1920x1080').split('x').map(Number), fps: Number(arg('fps', 60)), ss: Number(arg('ss', 1)), format: arg('format', 'song'),
  outro: flag('outro'), name: arg('name', 'export-check'), hash: flag('twice'), palette: Number(arg('palette', 0)),
};
const { browser, page } = await connectApp();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
const run = () => page.evaluate(async (o) => {
  const { loadSong } = await import('/src/export/song.ts');
  const { buildPlan } = await import('/src/export/plan-lib.mjs');
  const { renderExport } = await import('/src/export/offline.ts');
  const { desktopSink, openAac } = await import('/src/export/desktop-io.ts');
  const w = window;
  if (!w.__exSong || w.__exSong.file !== `${o.track}.wav`) {
    const bytes = await fetch(`/test-audio/${o.track}.wav`).then((r) => r.arrayBuffer());
    w.__exSong = await loadSong(new File([bytes], `${o.track}.wav`));
  }
  const song = w.__exSong;
  const plan = buildPlan({ format: o.format, song: song.file, title: song.title, artist: song.artist, window: { start: o.start, end: o.start + o.secs }, combo: o.combo, palette: o.palette, combo2: 'voyage-void', showcase: 'palettes', tour: { combos: ['silk-depth', 'ink-glow-depth', 'wisp-tunnel', 'warp', 'voyage-void'], every: 1 }, text: 'none', labels: false, nowPlaying: false, camera: 'planet' }, song.analysis);
  const sink = await desktopSink(`${o.name}-${o.size.join('x')}-${o.fps}`);
  const aac = await openAac(48000, 2, 192);
  const prog = [];
  const res = await renderExport(song, {
    plan, size: o.size, fps: o.fps, supersample: o.ss, albumPalette: null, portrait: true,
    overlay: { size: o.size, duration: o.secs, mark: { corner: 'br' }, outro: o.outro, title: null, texts: [], nowPlaying: null },
  }, sink, aac, (p) => { if (p.frame % 60 === 0) prog.push([p.stage, p.frame, +p.rate.toFixed(1)]); }, new AbortController().signal, { hashFrames: o.hash });
  return { ...res, prog: prog.slice(-4) };
}, opts);
const r1 = await run();
console.log(JSON.stringify(r1));
console.log(`render speed: ${(r1.frames / r1.wallSeconds).toFixed(1)} fps (${(r1.seconds / r1.wallSeconds).toFixed(2)}× real time) · ${(r1.bytes / 1048576).toFixed(1)} MB · ${r1.codec} ${r1.hardware}`);
if (opts.hash) {
  const r2 = await run();
  console.log(`determinism: ${r1.frameHash} vs ${r2.frameHash} → ${r1.frameHash === r2.frameHash ? 'IDENTICAL' : 'DIFFERENT'}`);
}
await browser.close().catch(() => undefined);
process.exit(0);
