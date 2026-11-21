#!/usr/bin/env node
// "I Wonder" trailer, window A, revised after Abdul's notes on the drafts:
// Wisp Flat on the intro; Silk Depth (planet) holds through the first drop until his
// first line ends (the voice band goes quiet at 41.1–43.2 s), Voyage Void from the next
// bar; one colour family for every style (Graduation's purple-pink, no yellow accent);
// Silk Flat near the end; every shot warmed up from the song's start.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, findCover, listSongs, MEDIA, mmss } from '../reel/lib.mjs';
import { styleLine } from '../reel/plan-lib.mjs';

const song = listSongs().find((s) => s.slug.startsWith('i-wonder'));
const a = analyse(song);
const bars = a.bars;
const near = (t) => bars.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), bars[0]);
const idx = (t) => bars.indexOf(near(t));
const W0 = near(21.0), W1 = near(81.2);
const k0 = idx(W0), kSilk = idx(28.6), kVoy = idx(42.73), k1 = idx(W1);
const B = (k) => +bars[k].toFixed(3);
const PAL = { album: true, mono: true };
const shots = [
  { at: B(k0), style: 'wisp', variant: 'ground', depth: false, palette: PAL },                    // intro: Wisp Flat
  { at: B(kSilk), style: 'silk', variant: 'silk', depth: true, palette: PAL, camera: 'planet' },  // build and the first drop
  { at: B(kVoy), style: 'voyage', variant: 'void', depth: false, palette: PAL },                  // after his first line
  { at: B(kVoy + 5), style: 'ink', variant: 'glow', depth: true, palette: PAL, camera: 'glide' },
  { at: B(kVoy + 9), style: 'warp', variant: 'warp', depth: false, palette: PAL },
  { at: B(kVoy + 11), style: 'silk', variant: 'silk', depth: false, palette: PAL },               // Silk Flat near the end
  { at: B(kVoy + 15), style: 'voyage', variant: 'void', depth: false, palette: PAL },             // under the lockup
];
// Options (env): ASPECT=9:16 (re-rendered in portrait, not cropped), CUT=1 (the ~30 s cut:
// 16 bars opening on the first drop, the lockup over its last four), SS (supersampling),
// CRF (master encode), NAME, OUT (folder under the repo).
const portrait = process.env.ASPECT === '9:16';
const cut = process.env.CUT === '1';
const kDrop = idx(35.1);
const ws = cut ? kDrop : k0, we = cut ? kDrop + 18 : k1;
// The cut, compressed: the drop and his line on Silk, Voyage, Ink, Warp, Silk Flat, and
// Voyage under the lockup (Wisp's quiet moment is the intro, in the full-length versions).
const useShots = cut ? [
  { ...shots[1], at: B(kDrop) },
  { ...shots[2], at: B(kVoy) },
  { ...shots[3], at: B(kVoy + 4) },
  { ...shots[4], at: B(kVoy + 6) },
  { ...shots[5], at: B(kVoy + 8) },
  { ...shots[6], at: B(kVoy + 10) },
] : shots;
const cardAt = B(we - 4);
const name = process.env.NAME || 'trailer-A2';
const plan = {
  format: 'trailer', song: song.file, title: 'I Wonder', artist: 'Kanye West', cover: findCover(song),
  window: { start: B(ws), end: B(we) }, size: portrait ? [1080, 1920] : [1920, 1080], fps: 60, quality: 'high', supersample: Number(process.env.SS || 1), preroll: 'full',
  shots: useShots, labels: true, labelPalette: false,
  nowPlaying: cut ? [+(B(ws) + 0.5).toFixed(3)] : [+(B(ws) + 0.5).toFixed(3), +(cardAt - 7.2).toFixed(3)], text: 'none', mark: false,
  card: { at: cardAt, line: 'see your music.' }, fadeIn: cut ? 0 : 0.6, name, out: process.env.OUT || `local-media/trailer/drafts/${name}`,
  ...(process.env.CRF ? { encode: { crf: Number(process.env.CRF), maxrate: '40M', bufsize: '80M' } } : {}),
};
const dur = (i) => (useShots[i + 1]?.at ?? plan.window.end) - useShots[i].at;
console.log(useShots.map((s, i) => `${mmss(s.at)} (+${(s.at - B(ws)).toFixed(1)} s) ${styleLine(s, false)} ${dur(i).toFixed(1)} s`).join('\n'), `\nlockup ${mmss(cardAt)}, end ${mmss(plan.window.end)}`);
writeFileSync(join(MEDIA, 'trailer', 'drafts', `${plan.name}.plan.json`), JSON.stringify(plan, null, 1));
