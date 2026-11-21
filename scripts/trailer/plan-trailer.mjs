#!/usr/bin/env node
// Trailer planner: proposes the best ~55–60 s windows of a song for the
// trailer format (bar-aligned cuts, drops on cuts, the lockup and "see your
// music." over the last phrase) and builds a cut plan for each, following the
// trailer rules (DOCS/SPRINT-LOG.md, batch 1.0.2): all five styles; Silk Depth
// (planet camera) carries the builds and Voyage Void the drops, with the most
// screen time; Ink, Warp and Wisp each get one clear moment where the music
// suits them; cuts only on bar lines, never faster than the music; a style
// label at each style change; the app's now-playing toast at the start.
//
//   node scripts/trailer/plan-trailer.mjs [--song <file|slug>] [--render-drafts]
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, findCover, listSongs, MEDIA, mmss } from '../reel/lib.mjs';
import { styleLine } from '../reel/plan-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const song = (() => { const want = opt('song', 'i-wonder'); return listSongs().find((s) => s.file === want || s.slug.startsWith(want)) ?? listSongs()[0]; })();
const a = analyse(song);
const bars = a.bars, I = a.curve.intensity;
const at = (t) => I[Math.max(0, Math.min(I.length - 1, Math.round(t * 60) - 1))] ?? 0;
const mean = (t0, t1) => { let s = 0, n = 0; for (let t = t0; t < t1; t += 0.25) { s += at(t); n++; } return s / Math.max(1, n); };
const drops = a.events.filter((e) => e.type === 'drop').map((e) => ({ ...e, t: e.beat ?? e.t }));
const builds = a.events.filter((e) => e.type === 'build').map((e) => ({ ...e, t: e.beat ?? e.t }));
const sections = a.sections.map((s) => s.t);
const barIdx = (t) => { let k = 0, d = Infinity; bars.forEach((b, i) => { const x = Math.abs(b - t); if (x < d) { d = x; k = i; } }); return k; };

// ── Windows ──
const cands = [];
for (let i = 0; i < bars.length; i++) {
  for (let j = i + 24; j < bars.length && bars[j] - bars[i] <= 64; j++) {
    const s = bars[i], e = bars[j], L = e - s;
    if (L < 54) continue;
    const inside = drops.filter((d) => d.t > s + 6 && d.t < e - 12);
    if (!inside.length) continue;
    const d0 = inside[0];
    const pos = (d0.t - s) / L;
    // Build → release: quieter before the first drop, louder after.
    const pre = mean(s, d0.t), post = mean(d0.t, Math.min(e, d0.t + 20));
    const arc = Math.max(0, post - pre);
    // Starts on a phrase (a multiple of 4 bars before the drop) and on a clean entry (not silence).
    const phraseStart = (barIdx(d0.t) - i) % 4 === 0 ? 0.35 : 0;
    const clean = at(s + 0.2) > 0.12 ? 0.15 : -0.4;
    // Ends on a phrase or a section change, letting the lockup land.
    const phraseEnd = (j - barIdx(d0.t)) % 8 === 0 ? 0.3 : (j - barIdx(d0.t)) % 4 === 0 ? 0.15 : 0;
    const sectionEnd = sections.some((x) => Math.abs(x - e) < 1.2) ? 0.25 : 0;
    const lenPref = -Math.abs(L - 58) * 0.02;
    const posScore = pos >= 0.2 && pos <= 0.45 ? 0.5 : pos < 0.6 ? 0.2 : 0;
    const extra = Math.min(2, inside.length - 1) * 0.15 + builds.filter((b) => b.t > s && b.t < d0.t).length * 0.2;
    const score = arc * 2 + phraseStart + clean + phraseEnd + sectionEnd + lenPref + posScore + extra + mean(s, e) * 0.5;
    cands.push({ start: s, end: e, i, j, drop: d0.t, drops: inside.map((d) => d.t), score, pos, arc, pre, post });
  }
}
cands.sort((x, y) => y.score - x.score);
const picks = [];
for (const c of cands) { if (picks.every((p) => c.end <= p.start + 4 || c.start >= p.end - 4) && picks.every((p) => Math.abs(p.drop - c.drop) > 1)) picks.push(c); if (picks.length === 3) break; }
picks.sort((x, y) => x.start - y.start);

// ── Cut plans ──
const ALBUM = 'album';
const SUNSET = 7, NEON = 3, VIOLET = 6;
const shot = (atT, style, variant, depth, palette, camera) => ({ at: +atT.toFixed(3), style, variant, depth, palette, ...(camera ? { camera } : {}) });
function cutPlan(w) {
  const i0 = w.i, i1 = w.j, kd = barIdx(w.drop);
  const B = (k) => bars[Math.max(i0, Math.min(i1, k))];
  // A timeline of bar-indexed segments, then shots from it.
  const seg = [];   // { k, style, variant, depth, palette, camera }
  const put = (k, style, variant, depth, palette, camera) => seg.push({ k, style, variant, depth, palette, camera });
  const pre = kd - i0;
  put(i0, 'silk', 'silk', true, ALBUM, 'planet');                       // Silk Depth carries the build
  if (pre >= 12) put(kd - 4, 'silk', 'silk', true, SUNSET, 'planet');    // a palette turn on a bar before the drop
  const post = i1 - kd;
  const dropLen = post >= 18 ? 6 : 4;
  put(kd, 'voyage', 'void', false, ALBUM);                               // the drop: Voyage Void
  let k = kd + dropLen;
  const later = w.drops.filter((d) => barIdx(d) >= k).map((d) => barIdx(d));
  const middle = [['ink', 'glow', true, ALBUM, 'glide', 4], ['warp', 'warp', false, NEON, null, 4]];
  if (post >= 22) middle.push(['silk', 'silk', true, VIOLET, 'planet', 4]);
  for (const [style, variant, depth, palette, camera, len] of middle) {
    if (k + len > i1 - 4) break;
    if (later.length && later[0] < k + len) break;
    put(k, style, variant, depth, palette, camera);
    k += len;
  }
  if (later.length) k = Math.max(k, later[0]);
  if (k < i1) put(k, 'voyage', 'void', false, ALBUM);                   // Voyage again, under the lockup
  // Wisp: the calmest 4 bars of the window, away from the drop and the ending (a quiet breath).
  let best = -1, bestV = Infinity;
  for (let x = i0; x + 4 <= i1 - 6; x += 2) {
    if (x + 4 > kd && x < kd + dropLen) continue;
    if (later.some((d) => x + 4 > d && x < d + 4)) continue;
    const v = mean(bars[x], bars[x + 4]);
    if (v < bestV) { bestV = v; best = x; }
  }
  if (best >= 0) {
    const active = (x) => [...seg].filter((g) => g.k <= x).pop();
    const resume = active(best + 4);
    for (let n = seg.length - 1; n >= 0; n--) if (seg[n].k >= best && seg[n].k < best + 4) seg.splice(n, 1);
    seg.push({ k: best, style: 'wisp', variant: 'ground', depth: true, palette: ALBUM });
    if (!seg.some((g) => g.k === best + 4) && resume) seg.push({ ...resume, k: best + 4 });
    seg.sort((x, y) => x.k - y.k);
  }
  // Shots; merge identical neighbours.
  const shots = [];
  for (const g of seg) {
    const p = shots[shots.length - 1];
    if (p && p.style === g.style && p.variant === g.variant && p.depth === g.depth && p.palette === g.palette) continue;
    shots.push(shot(B(g.k), g.style, g.variant, g.depth, g.palette, g.camera));
  }
  return { shots, cardAt: B(i1 - 4) };
}

const cover = findCover(song);
const plans = picks.map((w, n) => {
  const { shots, cardAt } = cutPlan(w);
  const name = `trailer-${'ABC'[n]}`;
  const plan = {
    format: 'trailer', song: song.file, title: 'I Wonder', artist: 'Kanye West', cover,
    window: { start: +w.start.toFixed(3), end: +w.end.toFixed(3) }, size: [1920, 1080], fps: 60, quality: 'high', supersample: 1, preroll: 8,
    shots, labels: true, labelPalette: false, nowPlaying: [+(w.start + 0.5).toFixed(3)], text: 'none', mark: false,
    card: { at: +cardAt.toFixed(3), line: 'see your music.' }, fadeIn: 0.6, name, out: `local-media/trailer/drafts/${name}`,
  };
  // A second, brief toast near the end when it fits before the lockup.
  const late = cardAt - 7.2;
  if (late - w.start > 30) plan.nowPlaying.push(+late.toFixed(3));
  const secs = (s) => shots.map((x, i) => [x, (shots[i + 1]?.at ?? cardAt) - x.at]).filter(([x]) => x.style === s).reduce((t, [, d]) => t + d, 0);
  const share = Object.fromEntries(['silk', 'voyage', 'ink', 'warp', 'wisp'].map((s) => [s, +secs(s).toFixed(1)]));
  plan.summary = `${mmss(w.start)}–${mmss(w.end)} (${(w.end - w.start).toFixed(1)} s, ${w.j - w.i} bars): ${w.drops.length} drop(s) at ${w.drops.map((d) => mmss(d)).join(', ')}; cuts ${shots.map((s) => `${mmss(s.at)} ${styleLine(s, false)}`).join(' → ')}; lockup ${mmss(cardAt)}. Screen time ${Object.entries(share).map(([k, v]) => `${k} ${v}s`).join(', ')}.`;
  return plan;
});

const dir = join(MEDIA, 'trailer', 'drafts');
mkdirSync(dir, { recursive: true });
for (const p of plans) { writeFileSync(join(dir, `${p.name}.plan.json`), JSON.stringify(p, null, 1)); console.log(`${p.name}: ${p.summary}`); }
writeFileSync(join(dir, 'candidates.json'), JSON.stringify(cands.slice(0, 20).map((c) => ({ ...c, start: mmss(c.start), end: mmss(c.end), drop: mmss(c.drop) })), null, 1));

if (argv.includes('--render-drafts')) {
  const { renderPlan } = await import('../reel/render.mjs');
  for (const p of plans) {
    const r = await renderPlan(p, { draft: true });
    copyFileSync(r.reel, join(dir, `${p.name}.mp4`));
  }
}
