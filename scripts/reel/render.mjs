#!/usr/bin/env node
// Reel / trailer renderer (local tool): a plan → video. Deterministic and
// offline: the engine renders in audio time at a fixed step through the verify
// harness (real GPU). Analysis always runs from the song's start; every shot
// warms up for PREROLL_S (or as much as there is) before its first frame, so
// nothing starts cold. Overlays (title, style line, mark, style labels, the
// app's now-playing toast, the lockup, text cards) are rendered once as
// transparent layers and composited with timed fades.
//
//   npm run reel -- <plan.json> [--draft] [--frames-only] [--encode-only] [--keep-frames]
//   npm run reel -- --queue        (every job in local-media/reels/queue.json)
//
// Outputs (plan.out, default local-media/reels/out/<date>-<slug>/): reel.mp4,
// reel-silent.mp4, cover.jpg, caption.txt, meta.json (+ ig-check/ after --ig-check).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { analyse, CACHE, ensureWav, ffmpeg, findCover, listSongs, mmss, probeTags, REELS, ROOT, slugify } from './lib.mjs';
import { LABEL_TIMING, paletteName, styleLine, TOAST_TIMING } from './plan-lib.mjs';

// ── Tuning ──────────────────────────────────────────────────────
const PREROLL_S = 8;
const PORT = Number(process.env.REEL_PORT || 5209);
const FRAMES_ROOT = process.env.REEL_FRAMES || 'C:/Users/abdul/sonora-reel-frames';
const { in: LABEL_IN, hold: LABEL_HOLD, out: LABEL_OUT } = LABEL_TIMING;
const { in: TOAST_IN, hold: TOAST_HOLD, out: TOAST_OUT } = TOAST_TIMING;   // the app's NP_SHOW_MS
/** Per-style export tuning against compression (see the sprint log): temporal dither strength. */
const EXPORT = JSON.parse(readFileSync(join(ROOT, 'scripts', 'reel', 'export-tuning.json'), 'utf8'));

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function songFor(plan) {
  if (plan.track) return { slug: plan.track, title: plan.title ?? plan.track, artist: plan.artist ?? '', wavUrl: `/test-audio/${plan.track}.wav`, wav: join(ROOT, 'test-audio', `${plan.track}.wav`) };
  const s = listSongs().find((x) => x.file === plan.song || x.slug === plan.song);
  if (!s) throw new Error(`song not found in local-media/songs: ${plan.song}`);
  const tags = probeTags(s.path);
  const wav = ensureWav(s);
  return { ...s, ...tags, title: plan.title ?? tags.title.replace(/\s*\((clean|explicit)\)/i, ''), artist: plan.artist ?? tags.artist.replace(/\s*\(feat\..*?\)/i, ''), wav, wavUrl: `/local-media/songs/_cache/${s.slug}.wav` };
}

async function startServer() {
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-reel' } });
  const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) return kill; } catch { /* wait */ } await wait(400); }
  kill();
  throw new Error('vite did not start');
}

const dataUrl = (file) => `data:${/\.png$/i.test(file) ? 'image/png' : 'image/jpeg'};base64,${readFileSync(file).toString('base64')}`;

// ── Frames ──────────────────────────────────────────────────────
async function renderFrames(browser, plan, song, dirFrames, draft) {
  const [OW, OH] = plan.size;
  const ss = draft ? 0.5 : plan.supersample ?? 1.333;
  const RW = Math.round((OW * ss) / 2) * 2, RH = Math.round((OH * ss) / 2) * 2;
  const fps = draft ? 30 : plan.fps ?? 60;
  const { start: W0, end: W1 } = plan.window;
  const total = Math.round((W1 - W0) * fps);
  const portrait = OH > OW ? 1 : 0;
  mkdirSync(dirFrames, { recursive: true });
  let albumResolved = null;
  const shots = plan.shots.map((s, i) => ({ ...s, end: plan.shots[i + 1]?.at ?? W1 }));
  for (const [n, s] of shots.entries()) {
    const k0 = Math.max(0, Math.round((s.at - W0) * fps)), k1 = Math.min(total, Math.round((s.end - W0) * fps));
    if (k1 <= k0) continue;
    if (existsSync(join(dirFrames, `f${String(k1 - 1).padStart(5, '0')}.jpg`))) { console.log(`  shot ${n}: done`); continue; }
    const page = await browser.newPage({ viewport: { width: RW, height: RH }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('  [page]', e.message));
    await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
    await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
    await page.evaluate((c) => window.__sonora.configure(c), { style: s.style, variant: s.variant, depth: !!s.depth, light: s.light ?? 'auto', quality: draft ? 'medium' : plan.quality ?? 'high', drift: false, camera: s.camera, responsiveness: plan.responsiveness, debug: { portrait } });
    const pal = s.palette ?? 0;
    if (pal === 'album' || pal?.album) {
      if (!albumResolved) {
        const cover = plan.cover ?? song.cover;
        if (!cover) throw new Error('album colours: no cover (local-media/covers or embedded art)');
        const ex = await page.evaluate((u) => window.__sonora.albumExtract(u), dataUrl(cover));
        if (!ex.resolved) throw new Error(`album colours: the cover gives no colours (${ex.kind})`);
        albumResolved = ex.resolved;
      }
      await page.evaluate((r) => window.__sonora.setPalette({ resolved: r }), albumResolved);
    } else if (typeof pal === 'number') await page.evaluate((i) => window.__sonora.setPalette({ index: i }), pal);
    else if (typeof pal.hue === 'number') await page.evaluate((hue) => window.__sonora.setPalette({ hue }), pal.hue);
    else if (pal.drift) await page.evaluate((i) => window.__sonora.setPalette({ index: i, driftDeg: 0, holdDrift: false }), pal.index ?? 0);
    await page.evaluate((u) => window.__sonora.loadTrackUrl(u), song.wavUrl);
    // Analysis from the song's start; the shot's own warm-up is rendered and discarded.
    const tStart = W0 + k0 / fps;
    const warm = Math.min(plan.preroll ?? PREROLL_S, tStart);
    await page.evaluate((x) => window.__sonora.analyseOnly(x), tStart - warm);
    const warmSteps = Math.round(warm * fps);
    for (let k = 0; k < warmSteps; k += 120) await page.evaluate(([m, d]) => window.__sonora.advance(m * d, d), [Math.min(120, warmSteps - k), 1 / fps]);
    const changes = (plan.changes ?? []).filter((c) => c.at > tStart && c.at < W0 + k1 / fps).sort((a, b) => a.at - b.at);
    const t0 = Date.now();
    for (let k = k0; k < k1; k++) {
      const now = W0 + (k + 1) / fps;
      while (changes.length && changes[0].at <= now) {
        const c = changes.shift();
        if (typeof c.palette === 'number') await page.evaluate((i) => window.__sonora.setPalette({ index: i }), c.palette);
        else if (c.palette === 'album' && albumResolved) await page.evaluate((r) => window.__sonora.setPalette({ resolved: r }), albumResolved);
        if (c.variant || c.depth !== undefined) await page.evaluate((x) => window.__sonora.configure(x), { variant: c.variant, depth: c.depth });
      }
      const url = await page.evaluate((d) => { window.__sonora.advance(d, d); return window.__sonora.snapshot('image/jpeg', 0.94); }, 1 / fps);
      writeFileSync(join(dirFrames, `f${String(k).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`  shot ${n}: ${styleLine(s)} · frames ${k0}–${k1 - 1} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    await page.close();
  }
  return { fps, total, RW, RH };
}

// ── Overlay layers ──────────────────────────────────────────────
async function renderLayers(browser, plan, song, dir) {
  const [OW, OH] = plan.size;
  const page = await browser.newPage({ viewport: { width: OW, height: OH }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/reel-overlay.html`);
  await page.waitForFunction(() => !!window.__overlay, null, { timeout: 30000 });
  const layers = [];
  const shot = async (name, layer, t0, t1, fadeIn = 0, fadeOut = 0) => {
    const file = join(dir, `${name}.png`);
    await page.evaluate((l) => window.__overlay.render(l), layer);
    await page.screenshot({ path: file, omitBackground: true });
    layers.push({ file, t0, t1, fadeIn, fadeOut });
  };
  const { start: W0, end: W1 } = plan.window;
  const D = W1 - W0;
  const text = plan.text ?? 'full';
  const lower = (s) => s.toLowerCase();
  if (text !== 'none' && plan.format !== 'trailer') {
    const tEnd = text === 'intro' ? 3.5 : D;
    await shot('title', { kind: 'title', text: lower(`${song.title} — ${song.artist}`.replace(/ — $/, '')) }, 0, tEnd, 0, text === 'intro' ? 0.4 : 0);
    // The style line follows the shots (beat switch, tour).
    for (const [i, s] of plan.shots.entries()) {
      const a = Math.max(0, s.at - W0), b = Math.min(text === 'intro' ? tEnd : D, (plan.shots[i + 1]?.at ?? W1) - W0);
      if (b > a) await shot(`styleline-${i}`, { kind: 'styleline', text: styleLine(s) }, a, b, 0, 0);
    }
  }
  if (plan.mark !== false && plan.format !== 'trailer') await shot('mark', { kind: 'mark' }, 0, D);
  // Style labels at each style change (never over the toast or the lockup).
  if (plan.labels) {
    for (const [i, s] of plan.shots.entries()) {
      const a = Math.max(0, s.at - W0) + (i === 0 ? 0.6 : 0.15);
      const b = a + LABEL_IN + LABEL_HOLD + LABEL_OUT;
      if (plan.card && W0 + b > plan.card.at) continue;
      const prev = plan.shots[i - 1];
      if (prev && styleLine(prev, false) === styleLine(s, false)) continue;   // a palette-only change keeps the label
      await shot(`label-${i}`, { kind: 'label', text: styleLine(s, plan.labelPalette ?? false) }, a, b, LABEL_IN, LABEL_OUT);
    }
  }
  if (plan.nowPlaying) {
    const art = plan.cover ?? song.cover;
    for (const [i, at] of (Array.isArray(plan.nowPlaying) ? plan.nowPlaying : [plan.nowPlaying]).entries()) {
      const a = at - W0, b = a + TOAST_IN + TOAST_HOLD + TOAST_OUT;
      await shot(`toast-${i}`, { kind: 'toast', title: song.title, artist: song.artist, album: song.album ?? '', art: art ? dataUrl(art) : '' }, a, Math.min(D, b), TOAST_IN, TOAST_OUT);
    }
  }
  for (const [i, c] of (plan.textCards ?? []).entries()) await shot(`text-${i}`, { kind: 'text', text: c.text }, c.at - W0, c.end - W0, 0.25, 0.25);
  if (plan.card) await shot('card', { kind: 'card', line: plan.card.line ?? 'see your music.' }, plan.card.at - W0 + 0.25, D, 0.9, 0);
  await page.close();
  return layers;
}

// ── Encode ──────────────────────────────────────────────────────
function encode(plan, song, dirFrames, layers, info, outDir, draft) {
  const [OW, OH] = plan.size;
  const { start: W0, end: W1 } = plan.window;
  const D = W1 - W0;
  const fps = info.fps;
  const styles = [...new Set(plan.shots.map((s) => s.style))];
  const dither = draft ? 0 : plan.export?.dither ?? Math.max(...styles.map((s) => EXPORT.dither[s] ?? EXPORT.dither.default));
  const inputs = ['-framerate', String(fps), '-i', join(dirFrames, 'f%05d.jpg'), '-ss', W0.toFixed(4), '-t', D.toFixed(4), '-i', song.wav];
  for (const l of layers) inputs.push('-loop', '1', '-framerate', String(fps), '-t', D.toFixed(4), '-i', l.file);
  const f = [];
  // Supersampled frames → output size (Lanczos); a little temporal dither keeps smooth gradients from banding after compression.
  // Trailer format: a short fade in, and the picture fades to Night under the lockup (reels: neither).
  const fadeIn = plan.fadeIn ? `,fade=t=in:st=0:d=${plan.fadeIn}` : '';
  const toCard = plan.card ? `,fade=t=out:st=${(plan.card.at - W0 + 0.15).toFixed(3)}:d=1.6:color=0x08080A` : '';
  f.push(`[0:v]scale=${OW}:${OH}:flags=lanczos,format=yuv444p${dither > 0 ? `,noise=c0s=${dither}:c0f=t` : ''}${fadeIn}${toCard}[b0]`);
  let cur = 'b0';
  layers.forEach((l, i) => {
    const src = `${i + 2}:v`;
    const fades = [l.fadeIn > 0 ? `fade=t=in:st=${l.t0.toFixed(3)}:d=${l.fadeIn}:alpha=1` : '', l.fadeOut > 0 ? `fade=t=out:st=${(l.t1 - l.fadeOut).toFixed(3)}:d=${l.fadeOut}:alpha=1` : ''].filter(Boolean).join(',');
    f.push(`[${src}]format=rgba${fades ? `,${fades}` : ''}[l${i}]`);
    f.push(`[${cur}][l${i}]overlay=0:0:enable='between(t,${l.t0.toFixed(3)},${l.t1.toFixed(3)})'[b${i + 1}]`);
    cur = `b${i + 1}`;
  });
  f.push(`[${cur}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`);
  const aOut = plan.card ? 0.6 : 0.25;
  f.push(`[1:a]afade=t=in:st=0:d=${plan.fadeIn ? 0.25 : 0.05},afade=t=out:st=${(D - aOut).toFixed(3)}:d=${aOut}[a]`);
  const reel = join(outDir, 'reel.mp4');
  const vq = draft ? ['-preset', 'veryfast', '-crf', '24'] : ['-preset', 'slow', '-b:v', '18M', '-maxrate', '20M', '-bufsize', '36M'];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-profile:v', 'high', ...vq, '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(fps), '-c:a', 'aac', '-b:a', draft ? '192k' : '320k', '-movflags', '+faststart', reel], { stdio: 'inherit' });
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', reel, '-c:v', 'copy', '-an', '-movflags', '+faststart', join(outDir, 'reel-silent.mp4')]);
  return reel;
}

/** cover.jpg: the strongest moment (the first drop, else the most intense second), with the title layers. */
function makeCover(plan, analysis, reel, outDir) {
  const { start: W0, end: W1 } = plan.window;
  const drop = analysis?.events.find((e) => e.type === 'drop' && e.t > W0 + 1 && e.t < W1 - 1);
  let t = drop ? drop.t - W0 + 0.6 : (W1 - W0) / 2;
  if (!drop && analysis) {
    let best = -1;
    for (let x = W0 + 1; x < W1 - 1; x += 0.5) { const v = analysis.curve.intensity[Math.round(x * 60)] ?? 0; if (v > best) { best = v; t = x - W0; } }
  }
  if (plan.coverAt !== undefined) t = plan.coverAt - W0;
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', reel, '-frames:v', '1', '-q:v', '2', join(outDir, 'cover.jpg')]);
  return t;
}

const tag = (s) => `#${s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')}`;
function caption(plan, song) {
  const s0 = plan.shots[0];
  const styles = [...new Set(plan.shots.map((s) => styleLine(s, false)))];
  const pals = [...new Set(plan.shots.map((s) => paletteName(s.palette)))];
  return [
    `${song.title} by ${song.artist}, visualized live with sonora.`,
    `every kick, hat and drop drives the visual. style: ${styles.length > 2 ? `${styles.length} styles` : styles.join(' + ')}, palette: ${pals.length > 2 ? `${pals.length} palettes` : pals.join(' + ')}.`,
    'send this to the friend who plays it at full volume.',
    'free for windows · link in bio',
    `#musicvisualizer ${song.artist ? tag(song.artist.split(/,|&| x | and /i)[0]) : ''} ${tag(plan.genre ?? 'electronic')} #visualizer #sonora`.replace(/\s+/g, ' '),
    '',
  ].join('\n');
  void s0;
}

export async function renderPlan(plan, opts = {}) {
  const draft = !!opts.draft;
  const song = songFor(plan);
  song.cover = plan.cover ?? (plan.track ? null : findCover(listSongs().find((x) => x.slug === song.slug)));
  const analysis = plan.track ? null : analyse(listSongs().find((x) => x.slug === song.slug));
  const date = new Date().toISOString().slice(0, 10);
  const name = plan.name ?? `${date}-${slugify(song.title)}${plan.format ? `-${plan.format}` : ''}`;
  const outDir = plan.out ? join(ROOT, plan.out) : join(REELS, 'out', name);
  const dirFrames = join(FRAMES_ROOT, `${name}${draft ? '-draft' : ''}`);
  mkdirSync(outDir, { recursive: true });
  const kill = await startServer();
  let info;
  try {
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
    if (!opts.encodeOnly) info = await renderFrames(browser, plan, song, dirFrames, draft);
    else info = { fps: draft ? 30 : plan.fps ?? 60 };
    const layerDir = join(dirFrames, 'layers');
    mkdirSync(layerDir, { recursive: true });
    const layers = opts.framesOnly ? [] : await renderLayers(browser, plan, song, layerDir);
    await browser.close();
    if (opts.framesOnly) return { outDir };
    const reel = encode(plan, song, dirFrames, layers, info, outDir, draft);
    const coverT = makeCover(plan, analysis, reel, outDir);
    writeFileSync(join(outDir, 'caption.txt'), caption(plan, song));
    const meta = {
      song: { title: song.title, artist: song.artist, album: song.album ?? '', file: plan.song ?? plan.track },
      start: mmss(plan.window.start), startSeconds: plan.window.start, end: mmss(plan.window.end), duration: +(plan.window.end - plan.window.start).toFixed(2),
      instagramMusicStart: mmss(plan.window.start),
      format: plan.format ?? 'song', aspect: `${plan.size[0]}x${plan.size[1]}`, fps: info.fps, draft,
      shots: plan.shots.map((s) => ({ at: s.at, line: styleLine(s) })), coverAt: +coverT.toFixed(2),
      bpm: analysis?.bpm, rendered: new Date().toISOString(), plan,
    };
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
    if (!opts.keepFrames && !draft) rmSync(dirFrames, { recursive: true, force: true });
    console.log(`→ ${outDir} (reel.mp4 ${(statSync(reel).size / 1048576).toFixed(1)} MB)`);
    return { outDir, reel, meta };
  } finally { kill(); }
}

// ── CLI ─────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/reel/render.mjs')) {
  const opts = { draft: flag('draft'), framesOnly: flag('frames-only'), encodeOnly: flag('encode-only'), keepFrames: flag('keep-frames') };
  if (flag('queue')) {
    const qf = join(REELS, 'queue.json');
    const queue = existsSync(qf) ? JSON.parse(readFileSync(qf, 'utf8')) : [];
    console.log(`queue: ${queue.filter((j) => !j.done).length} job(s)`);
    for (const job of queue) {
      if (job.done) continue;
      try { const r = await renderPlan(job.plan, opts); job.done = new Date().toISOString(); job.out = r.outDir; } catch (e) { job.error = String(e); console.error(e); }
      writeFileSync(qf, JSON.stringify(queue, null, 1));
    }
  } else {
    const file = argv.find((a) => !a.startsWith('--'));
    if (!file) { console.error('usage: npm run reel -- <plan.json> [--draft] | --queue'); process.exit(2); }
    await renderPlan(JSON.parse(readFileSync(file, 'utf8')), opts);
  }
}
void CACHE; void readdirSync;
