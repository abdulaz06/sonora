#!/usr/bin/env node
// Sample exports for the review (and the site's "make videos" clips): a real
// song with embedded artwork through the app's Export pipeline, in 9:16 and
// 16:9, with text, the now-playing card, album colours, outro on and off.
// Start the app first (scripts/app/dev.sh). Songs stay in local-media/.
//   node scripts/app/export-samples.mjs <song.mp3> [--only portrait,landscape]
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { connectApp } from './cdp.mjs';

const song = process.argv[2];
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1].split(',') : null; })();
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : join('verify', 'review-1.1', 'exports'); })();
mkdirSync(OUT, { recursive: true });
const { page } = await connectApp();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
await page.reload();
await page.waitForFunction(() => !!window.__sonoraHooks?.renderExport, null, { timeout: 60000 });
const bytes = [...readFileSync(song)];
const SAMPLES = [
  { id: 'portrait', name: 'sample 9x16', size: [1080, 1920], fps: 60, secs: 20, format: 'tour', combo: 'silk-depth', palette: 'album', outro: true,
    title: { style: 'cinematic', in: 0, out: 3.2 }, nowPlaying: true, corner: 'br',
    texts: [{ text: 'first time hearing it like this', start: 6, end: 10, pos: 'center', size: 'l', font: 'instrument', case: 'lower' }] },
  { id: 'landscape', name: 'sample 16x9', size: [1920, 1080], fps: 60, secs: 15, format: 'song', combo: 'voyage-city', palette: 'album', outro: false,
    title: { style: 'reel', in: 0, out: 4 }, nowPlaying: false, corner: 'br', texts: [] },
  // Website clips (sonora's own demo track: no third-party music or artwork).
  { id: 'site-portrait', name: 'site 9x16', size: [1080, 1920], fps: 60, secs: 15, format: 'tour', combo: 'silk-depth', palette: 6, outro: false, start: 24,
    title: { style: 'reel', in: 0, out: 15 }, nowPlaying: false, corner: 'br', texts: [], song: { title: 'sonora demo', artist: 'made for sonora' } },
  { id: 'site-landscape', name: 'site 16x9', size: [1920, 1080], fps: 60, secs: 12, format: 'song', combo: 'voyage-city', palette: 5, outro: false, start: 47,
    title: { style: 'reel', in: 0, out: 12 }, nowPlaying: false, corner: 'br', texts: [], song: { title: 'sonora demo', artist: 'made for sonora' } },
];
for (const s of SAMPLES) {
  if (only && !only.includes(s.id)) continue;
  const r = await page.evaluate(async ({ s, bytes, file }) => {
    const H = window.__sonoraHooks;
    window.__samples ??= {};
    window.__samples[file] ??= await H.loadSong(new File([new Uint8Array(bytes)], file));
    const song = { ...window.__samples[file], ...(s.song ?? {}) };
    const { paletteFromArt } = await import('/src/app/album-colours.ts');
    const album = song.cover ? await paletteFromArt(song.cover) : null;
    const sug = song.analysis.suggestions[String(s.secs)]?.[0] ?? song.analysis.suggestions['30'][0];
    const st = s.start !== undefined ? song.analysis.bars.reduce((b, x) => (Math.abs(x - s.start) < Math.abs(b - s.start) ? x : b), s.start) : sug.start;
    const w = { start: st, end: st + s.secs };
    const plan = H.buildPlan({ format: s.format, song: song.file, title: song.title, artist: song.artist, window: w, combo: s.combo, palette: s.palette, combo2: 'voyage-void',
      showcase: 'palettes', tour: { combos: ['silk-depth', 'ink-glow-depth', 'wisp-tunnel', 'voyage-city', 'warp'], every: 2 }, text: 'none', labels: false, nowPlaying: false, camera: 'planet' }, song.analysis);
    const sink = await H.desktopSink(`${song.title.toLowerCase()} · ${s.name}`);
    const aac = await H.openAac(song.sampleRate, 2, 192);
    const D = w.end - w.start;
    const res = await H.renderExport(song, {
      plan, size: s.size, fps: s.fps, supersample: 1.5, albumPalette: album, portrait: true,
      overlay: { size: s.size, duration: D, mark: { corner: s.corner }, outro: s.outro,
        title: { ...s.title, title: song.title, artist: song.artist }, texts: s.texts,
        nowPlaying: s.nowPlaying ? { at: 0.4, title: song.title, artist: song.artist, album: song.album, art: song.cover } : null },
    }, sink, aac, () => {}, new AbortController().signal);
    return { ...res, album: !!album, cover: !!song.cover, window: w };
  }, { s, bytes, file: basename(song) });
  console.log(`${s.id}: ${r.path} · ${(r.bytes / 1048576).toFixed(1)} MB · ${r.frames} frames · ${(r.frames / r.wallSeconds).toFixed(1)} fps render · album colours ${r.album} · window ${r.window.start.toFixed(1)} s`);
  copyFileSync(r.path, join(OUT, `${s.id}.mp4`));
}
process.exit(0);
