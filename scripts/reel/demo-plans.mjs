#!/usr/bin/env node
// The review's demo reels on a local song: one Song reel (album colours), one
// Beat switch (on a drop), one Showcase (a palette per bar). Writes the plans to
// local-media/reels/plans/demo-*.json; render them with npm run reel -- <plan>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, listSongs, REELS } from './lib.mjs';
import { buildPlan, snapToBar } from './plan-lib.mjs';

const song = listSongs().find((s) => s.slug.startsWith(process.argv[2] ?? 'i-wonder')) ?? listSongs()[0];
const a = analyse(song);
const base = { song: song.file, title: 'I Wonder', artist: 'Kanye West', genre: 'hiphop', text: 'full', labels: true, nowPlaying: false, palette: 0, camera: 'planet' };
const drops = a.events.filter((e) => e.type === 'drop').map((e) => e.beat ?? e.t);
const win = (start, bars) => { const s = snapToBar(start, a.bars); const i = a.bars.indexOf(s); return { start: s, end: a.bars[Math.min(a.bars.length - 1, i + bars)] }; };
const plans = {
  'demo-song': buildPlan({ ...base, format: 'album', combo: 'silk-depth', nowPlaying: true, window: win(drops[0] - 8 * a.beatPeriod * 4 / 2, 16) }, a),
  'demo-beatswitch': buildPlan({ ...base, format: 'beatswitch', combo: 'ink-glow-depth', palette: 'album', combo2: 'voyage-void', palette2: 'album', switchAt: drops[1], window: win(drops[1] - 4 * 4 * a.beatPeriod, 11), camera: 'glide' }, a),
  'demo-showcase': buildPlan({ ...base, format: 'showcase', combo: 'warp', showcase: 'palettes', window: win(drops[2], 10) }, a),
};
mkdirSync(join(REELS, 'plans'), { recursive: true });
const date = new Date().toISOString().slice(0, 10);
for (const [n, p] of Object.entries(plans)) {
  p.name = `${date}-${n}`;
  writeFileSync(join(REELS, 'plans', `${n}.json`), JSON.stringify(p, null, 1));
  console.log(n, p.window, p.shots.map((s) => `${s.at.toFixed(1)} ${s.style}`).join(' → '), p.changes ? `${p.changes.length} palette changes` : '');
}
