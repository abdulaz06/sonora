// 1.2 review page: verify/review-1.2/index.html (open it in a browser).
//
//   node scripts/review-12.mjs render [ids…]   arc contact sheets, 24 s clips with the track's audio, 9:16 stills
//   node scripts/review-12.mjs html            the page, from those files and verify/gates-1.2/*.log
//
// Every item: a contact sheet of 8 moments across house-124 (silence → build → drop → breakdown),
// a 24 s clip (38–62 s: build, drop, after), a 9:16 still at the drop, and its gate rows.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'verify', 'review-1.2');
const SCRATCH = process.env.REVIEW_SCRATCH || join(process.env.TEMP || '/tmp', 'sonora-review-12');
const ARC = [10, 22, 34, 44, 50.5, 58, 72, 88];
const CLIP = [38, 24];
const STILL_916 = 52;

// id, title, style, look, view, light, filter, group
export const ITEMS = [
  ['silk-helix-flat', 'Silk · Helix · Flat', 'silk', 'helix', 'flat', 'auto', '', 'Silk Helix'],
  ['silk-helix-depth', 'Silk · Helix · Depth', 'silk', 'helix', 'depth', 'auto', '', 'Silk Helix'],
  ['stage-club', 'Stage · Club', 'stage', 'club', 'flat', 'auto', '', 'Stage'],
  ['stage-arena', 'Stage · Arena', 'stage', 'arena', 'flat', 'auto', '', 'Stage'],
  ['stage-cathedral', 'Stage · Cathedral', 'stage', 'cathedral', 'flat', 'auto', '', 'Stage'],
  ['cymatics-stone', 'Cymatics · Stone', 'cymatics', 'stone', 'flat', 'auto', '', 'Cymatics'],
  ['cymatics-sand', 'Cymatics · Sand', 'cymatics', 'sand', 'flat', 'auto', '', 'Cymatics'],
  ['cymatics-liquid', 'Cymatics · Liquid', 'cymatics', 'liquid', 'flat', 'auto', '', 'Cymatics'],
  ['glass-bubbles', 'Glass · Bubbles', 'glass', 'bubbles', 'flat', 'auto', '', 'Glass'],
  ['glass-fins', 'Glass · Fins', 'glass', 'fins', 'flat', 'auto', '', 'Glass'],
  ['glass-chrome', 'Glass · Chrome', 'glass', 'chrome', 'flat', 'auto', '', 'Glass'],
  ['cover-light', 'Cover · paper ground (generated artwork)', 'cover', 'cover', 'flat', 'auto', '', 'Cover'],
  ['cover-dark', 'Cover · dark ground (generated artwork)', 'cover', 'cover', 'flat', 'dark', '', 'Cover'],
  ['cover-art', 'Cover · with a cover (synthetic test cover)', 'cover', 'cover', 'flat', 'auto', '', 'Cover', 'busy-02.jpg'],
  ['echo-glow', 'Echo · Glow', 'echo', 'glow', 'flat', 'auto', '', 'Echo'],
  ['echo-trace', 'Echo · Trace', 'echo', 'trace', 'flat', 'auto', '', 'Echo'],
  ['glyph-ink', 'Glyph filter · over Ink Glow', 'ink', 'glow', 'depth', 'auto', 'glyph', 'Filters'],
  ['glyph-stage', 'Glyph filter (large) · over Stage Arena', 'stage', 'arena', 'flat', 'auto', 'glyph:large', 'Filters'],
  ['reeded-silk', 'Reeded glass · vertical · over Silk', 'silk', 'silk', 'flat', 'auto', 'reeded', 'Filters'],
  ['reeded-glass', 'Reeded glass · radial · over Glass Bubbles', 'glass', 'bubbles', 'flat', 'auto', 'reeded:radial', 'Filters'],
];

const COVERS = 'C:/Users/abdul/OneDrive/Documents/sonora/local-media/covers/test';
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, ...env }, shell: false, encoding: 'utf8' });
  if (r.status !== 0) console.log(`  ! ${cmd} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').slice(-400)}`);
  return r;
};

function render(ids) {
  mkdirSync(OUT, { recursive: true });
  for (const it of ITEMS.filter((x) => !ids.length || ids.includes(x[0]))) {
    const [id, , style, look, view, light, filter, , cover] = it;
    const env = {
      SONORA_FILTER: filter || '', SNAP_LOOK: look, SNAP_DEPTH: view === 'depth' ? '1' : '0',
      ...(cover ? { SNAP_COVER: `${COVERS}/${cover}` } : {}), ...(light !== 'auto' ? { SNAP_LIGHT: light } : {}),
    };
    if (!filter) delete env.SONORA_FILTER;
    console.log(`▶ ${id}`);
    // 1. Arc contact sheet (8 moments, 640×360).
    const snapDir = join(SCRATCH, id);
    rmSync(snapDir, { recursive: true, force: true });
    mkdirSync(snapDir, { recursive: true });
    run(process.execPath, ['scripts/snapshots.mjs', style, 'house-124', ...ARC.map(String)], { ...env, SNAP_W: '640', SNAP_H: '360', SNAP_OUT: snapDir });
    const shots = ARC.map((t) => join(snapDir, `${t}.png`)).filter(existsSync);
    if (shots.length) run('python', ['-I', '-c', `
import sys
from PIL import Image, ImageDraw
ims=[Image.open(p) for p in sys.argv[2:]]
labels=${JSON.stringify(ARC.map((t) => `${t}s`))}
W=Image.new('RGB',(640*4,360*2),(8,8,10))
d=ImageDraw.Draw(W)
for i,im in enumerate(ims):
    W.paste(im,((i%4)*640,(i//4)*360)); d.text(((i%4)*640+10,(i//4)*360+8),labels[i],fill=(236,231,223))
W.save(sys.argv[1], quality=88)`, join(OUT, `${id}-arc.jpg`), ...shots]);
    // 2. 9:16 still at the drop.
    run(process.execPath, ['scripts/snapshots.mjs', style, 'house-124', String(STILL_916)], { ...env, SNAP_W: '1080', SNAP_H: '1920', SNAP_OUT: snapDir });
    const p916 = join(snapDir, `${STILL_916}.png`);
    if (existsSync(p916)) run('python', ['-I', '-c', `
import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGB').resize((540,960)).save(sys.argv[2], quality=90)`, p916, join(OUT, `${id}-916.jpg`)]);
    // 3. 24 s clip with the track's audio.
    const seq = join(SCRATCH, `${id}-seq`);
    rmSync(seq, { recursive: true, force: true });
    run(process.execPath, ['scripts/frame-seq.mjs', style, look, 'house-124', String(CLIP[0]), String(CLIP[1]), view, '2', seq],
      { ...env, SEQ_W: '960', SEQ_H: '540', SEQ_JPG: '1', ...(cover ? { SEQ_COVER: `${COVERS}/${cover}` } : {}), ...(light !== 'auto' ? { SEQ_LIGHT: light } : {}) });
    if (existsSync(join(seq, 'f00000.jpg'))) {
      run(ffmpegPath, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(seq, 'f%05d.jpg'), '-ss', String(CLIP[0] + 2 / 60), '-t', String(CLIP[1]),
        '-i', join(ROOT, 'test-audio', 'house-124.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', join(OUT, `${id}-clip.mp4`)]);
    }
    rmSync(seq, { recursive: true, force: true });
    rmSync(snapDir, { recursive: true, force: true });
  }
}

// ── Page ────────────────────────────────────────────────────────
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const LOGS = join(ROOT, 'verify', 'gates-1.2');

function gateRows(it) {
  const [id, , style, look, view, light, filter] = it;
  const rows = [];
  const sf = read(join(LOGS, 'syncflicker.log')).split('\n');
  const fl = read(join(LOGS, 'filters.log')).split('\n');
  const mo = read(join(LOGS, 'motion.log')).split('\n');
  const dt = read(join(LOGS, 'dt.log')).split('\n');
  const cost = (read(join(LOGS, 'cost.log')) + read(join(LOGS, 'filter-cost.log'))).split('\n');
  const comp = read(join(LOGS, 'compile.log')).split('\n');
  const col = read(join(LOGS, 'colour.log')).split('\n');
  const L = light === 'auto' ? 'auto' : light;
  const pick = (lines, pref) => lines.filter((l) => l.startsWith(pref));
  if (filter) {
    const f = filter.split(':')[0];
    rows.push(...pick(fl, `SYNC ${f} ${style} ${look}`).map((l) => ['sync', l.replace(/^SYNC \S+ \S+ \S+ \S+ /, '')]));
    rows.push(...pick(fl, `FLICKER ${f} ${style} ${look}`).map((l) => ['flicker', l.replace(/^FLICKER \S+ \S+ \S+ \S+ /, '')]));
    rows.push(...cost.filter((l) => l.includes(`${style}:${look}:${view}:${f} `) || l.includes(`${style}:${look}:${view} medium`)).map((l) => ['cost', l.replace(/^COST /, '')]));
    rows.push(...pick(fl, `COST ${style}:${look}:${view}`).map((l) => ['cost', l.replace(/^COST /, '')]));
  } else {
    rows.push(...pick(sf, `SYNC ${style} ${look} ${view} ${L}`).map((l) => ['sync', l.replace(/^SYNC \S+ \S+ \S+ \S+ /, '')]));
    rows.push(...pick(sf, `FLICKER ${style} ${look} ${view} ${L}`).map((l) => ['flicker', l.replace(/^FLICKER \S+ \S+ \S+ \S+ /, '')]));
    rows.push(...pick(mo, `MOTION ${style} ${look} ${view}`).map((l) => ['motion', l.replace(/^MOTION \S+ \S+ \S+ /, '')]));
    rows.push(...pick(dt, `DT ${style} ${look}`).map((l) => ['dt sweep', l.replace(/^DT \S+ \S+ \S+ /, '')]));
    rows.push(...cost.filter((l) => l.includes(` ${style}:${look}:${view} `)).map((l) => ['cost', l.replace(/^COST /, '')]));
    rows.push(...comp.filter((l) => l.includes(` ${style}:${look}:${view}:`)).map((l) => ['compile', l.replace(/^COMPILE /, '')]));
    const cid = id === 'cover-art' ? 'cover-light' : id;
    rows.push(...col.filter((l) => l.startsWith(`${cid} `)).map((l) => ['colour', l.slice(cid.length + 1)]));
  }
  return rows;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sizeOf = (p) => (existsSync(p) ? statSync(p).size : 0);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

function html() {
  const summary = read(join(OUT, 'summary.html'));
  const sizes = [
    ['Echo moves', sizeOf(join(ROOT, 'src/assets/echo/moves.bin'))],
    ['New thumbnails, loops, (i) pictures', readdirSync(join(ROOT, 'src/assets/media')).filter((f) => /^(stage|cymatics|glass|cover|echo|silk-helix|explain-filter|pal-(stage|cymatics|glass|cover|echo))/.test(f)).reduce((a, f) => a + sizeOf(join(ROOT, 'src/assets/media', f)), 0)],
  ];
  const groups = [...new Set(ITEMS.map((x) => x[7]))];
  const body = groups.map((g) => `<h2>${g}</h2>` + ITEMS.filter((x) => x[7] === g).map((it) => {
    const [id, title] = it;
    const rows = gateRows(it);
    return `<section id="${id}"><h3>${esc(title)}</h3>
<div class="media">
  ${existsSync(join(OUT, `${id}-clip.mp4`)) ? `<video src="${id}-clip.mp4" controls preload="none" poster="${id}-arc.jpg"></video>` : '<p class="miss">clip missing</p>'}
  ${existsSync(join(OUT, `${id}-916.jpg`)) ? `<img class="p916" src="${id}-916.jpg" alt="9:16">` : ''}
</div>
${existsSync(join(OUT, `${id}-arc.jpg`)) ? `<img class="arc" src="${id}-arc.jpg" alt="arc">` : ''}
<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td class="${/FAIL/.test(v) ? 'fail' : /PASS/.test(v) ? 'pass' : ''}">${esc(v)}</td></tr>`).join('') || '<tr><td>gate logs pending</td></tr>'}</table>
</section>`;
  }).join('')).join('');
  const assets = read(join(ROOT, 'ASSETS.md'));
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonora 1.2 review</title>
<style>
body{background:#08080a;color:#ece7df;font:14px/1.5 "IBM Plex Mono",Consolas,monospace;margin:0;padding:32px 40px;max-width:1400px}
h1{font-size:20px;letter-spacing:.12em;text-transform:uppercase}h2{margin-top:48px;border-top:1px solid rgba(236,231,223,.12);padding-top:16px;letter-spacing:.1em;text-transform:uppercase;font-size:15px}
h3{font-size:14px;margin:28px 0 8px}section{margin-bottom:28px}.media{display:flex;gap:16px;align-items:flex-start}
video{width:960px;max-width:72vw;background:#000}.p916{height:540px}.arc{width:100%;margin-top:8px}
table{border-collapse:collapse;width:100%;margin-top:8px;font-size:12px}th{text-align:left;width:90px;color:rgba(236,231,223,.6);font-weight:400;vertical-align:top;padding:2px 8px 2px 0}
td{padding:2px 0;border-bottom:1px solid rgba(236,231,223,.06)}td.fail{color:#ff8a7a}td.pass{color:#b9e3b0}pre{white-space:pre-wrap;font-size:12px;color:rgba(236,231,223,.8)}
a{color:#ece7df}.miss{color:rgba(236,231,223,.4)}nav a{margin-right:12px}
</style></head><body>
<h1>sonora 1.2 · review</h1>
<nav>${groups.map((g) => `<a href="#${ITEMS.find((x) => x[7] === g)[0]}">${g}</a>`).join('')}<a href="#sizes">sizes</a><a href="#assets">assets</a></nav>
${summary}
${body}
<h2 id="sizes">installer size added</h2>
<table>${sizes.map(([k, v]) => `<tr><th style="width:320px">${k}</th><td>${mb(v)}</td></tr>`).join('')}<tr><th style="width:320px">total (raw, before installer compression)</th><td>${mb(sizes.reduce((a, [, v]) => a + v, 0))}</td></tr></table>
<h2 id="assets">ASSETS.md</h2><pre>${esc(assets)}</pre>
</body></html>`;
  writeFileSync(join(OUT, 'index.html'), page);
  console.log(`→ ${join(OUT, 'index.html')}`);
}

const [mode, ...ids] = process.argv.slice(2);
if (mode === 'render') render(ids);
else html();
