#!/usr/bin/env node
// Prototype check-in page: clips, 9:16 stills and arc sheets in verify/proto-1.2/
// with a note per item on what changed and what to look for.
//   node scripts/proto-page.mjs
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'verify', 'proto-1.2');
const ITEMS = [
  ['echo-glow', 'Echo · Glow', 'Bodies with volume (a silhouette with a rim of light, the eerie skeleton faint inside), light trails from hands and feet, less glow. 24 moves (17 new). From the build: a synced trio; the drop: a row of synced dancers sliding out from the centre, then a tower (the camera cranes up), a grid seen from above, a ring. Time echoes stay behind the centre dancer.'],
  ['echo-trace', 'Echo · Trace (paper)', 'The same on paper: translucent ink bodies with a darker contour.'],
  ['glass-bubbles', 'Glass · Bubbles', 'Bigger, separate bubbles that swell on each kick; a field of tiny glass beads and bokeh behind them (seen refracted through the bubbles too), glinting on kicks.'],
  ['glass-fins', 'Glass · Fins', 'An endless twisting ribbon with a chase camera flying alongside it; each kick turns the slats a step and hits the camera (a field-of-view punch, a small roll); the drop surges forward.'],
  ['glass-chrome', 'Glass · Chrome (disco universe)', 'A universe of mirror-ball planets flown through with a chase camera: every kick sends a ring of tilting, flashing tiles across every planet; pairs of planets ram into each other on the beat grid (the drop: the camera surges and a pair collides a beat later with a flash). Tiles twinkle with the highs.'],
  ['silk-helix-depth', 'Silk Helix · Depth', 'Rebuilt in 3D: a twisted column of silk ringed like a planet. The camera orbits it, swinging from edge-on to above and below; builds rise and close in; the drop unwinds the helix, adds a third strand and swoops the camera round. Kicks pluck the strands and send a wave out through the rings.'],
  ['silk-helix-flat', 'Silk Helix · Flat', 'Straight down the axis: the same piece as a turning mandala (the vortex of the strands inside the rings).'],
  ['reeded-silk', 'Reeded glass (new default: radial, very fine ribs)', 'The filter at its new default over Silk. Rib width is now a slider in Settings › Filter, very fine at the narrow end.'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const body = ITEMS.map(([id, title, note]) => `<section><h2>${esc(title)}</h2><p>${esc(note)}</p>
<div class="m">${existsSync(join(OUT, `${id}-clip.mp4`)) ? `<video src="${id}-clip.mp4" controls preload="none" poster="${id}-arc.jpg"></video>` : '<p class="miss">clip missing</p>'}
${existsSync(join(OUT, `${id}-916.jpg`)) ? `<img class="p" src="${id}-916.jpg" alt="9:16">` : ''}</div>
${existsSync(join(OUT, `${id}-arc.jpg`)) ? `<img class="a" src="${id}-arc.jpg" alt="arc">` : ''}</section>`).join('\n');
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonora 1.2 · prototypes</title>
<style>body{background:#08080a;color:#ece7df;font:14px/1.55 "IBM Plex Mono",Consolas,monospace;margin:0;padding:32px 40px;max-width:1400px}
h1{font-size:20px;letter-spacing:.12em;text-transform:uppercase}h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;border-top:1px solid rgba(236,231,223,.12);padding-top:16px;margin-top:40px}
p{max-width:980px;color:rgba(236,231,223,.85)}.m{display:flex;gap:16px;align-items:flex-start}video{width:960px;max-width:72vw;background:#000}.p{height:540px}.a{width:100%;margin-top:8px}.miss{color:rgba(236,231,223,.4)}</style></head><body>
<h1>sonora 1.2 · prototypes for a yes / no</h1>
<p>Each clip is 40 s of the house-124 test track from 40 s (the build, the drop at 49.7 s, the groove after it), with audio. Below each: a 9:16 still and stills across the whole song (10–88 s). Not polished or gated yet: this is about direction.</p>
${body}
</body></html>`);
console.log(`→ ${join(OUT, 'index.html')}`);
