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
const cardAt = B(k1 - 4);
const plan = {
  format: 'trailer', song: song.file, title: 'I Wonder', artist: 'Kanye West', cover: findCover(song),
  window: { start: B(k0), end: B(k1) }, size: [1920, 1080], fps: 60, quality: 'high', supersample: Number(process.env.SS || 1), preroll: 'full',
  shots, labels: true, labelPalette: false, nowPlaying: [+(B(k0) + 0.5).toFixed(3), +(cardAt - 7.2).toFixed(3)], text: 'none', mark: false,
  card: { at: cardAt, line: 'see your music.' }, fadeIn: 0.6, name: process.env.NAME || 'trailer-A2', out: `local-media/trailer/drafts/${process.env.NAME || 'trailer-A2'}`,
};
const dur = (i) => (shots[i + 1]?.at ?? plan.window.end) - shots[i].at;
console.log(shots.map((s, i) => `${mmss(s.at)} (+${(s.at - W0).toFixed(1)} s) ${styleLine(s, false)} ${dur(i).toFixed(1)} s`).join('\n'), `\nlockup ${mmss(cardAt)}, end ${mmss(plan.window.end)}`);
writeFileSync(join(MEDIA, 'trailer', 'drafts', `${plan.name}.plan.json`), JSON.stringify(plan, null, 1));
