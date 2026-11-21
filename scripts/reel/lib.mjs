// Shared by the reel studio (scripts/reel/studio.mjs), the reel renderer
// (scripts/reel/render.mjs) and the trailer planner: local songs and covers,
// audio extraction, and the cached whole-song analysis. Local only: songs,
// covers and renders live in local-media/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MEDIA = join(ROOT, 'local-media');
export const SONGS = join(MEDIA, 'songs');
export const COVERS = join(MEDIA, 'covers');
export const CACHE = join(SONGS, '_cache');
export const REELS = join(MEDIA, 'reels');
export const ffmpeg = (await import('ffmpeg-static')).default;

const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|mp4|mov|mkv|m4v)$/i;

export const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song';

/** Songs in local-media/songs (audio or video files). */
export function listSongs() {
  if (!existsSync(SONGS)) return [];
  return readdirSync(SONGS).filter((f) => AUDIO.test(f)).sort().map((f) => {
    const { title, artist } = parseName(f);
    return { file: f, path: join(SONGS, f), slug: slugify(basename(f, extname(f))), title, artist };
  });
}

/** "Title (Clean) - Artist (feat. X).mp3" → title / artist (tags win when present, see probeTags). */
export function parseName(file) {
  const base = basename(file, extname(file));
  const m = base.split(/\s+[-–—]\s+/);
  return m.length >= 2 ? { title: m[0].trim(), artist: m.slice(1).join(' - ').trim() } : { title: base.trim(), artist: '' };
}

/** Title / artist / album from the file's tags (ffmpeg), falling back to the file name. */
export function probeTags(path) {
  const meta = {};
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-i', path, '-f', 'ffmetadata', '-'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    for (const line of out.split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) meta[line.slice(0, i).toLowerCase()] = line.slice(i + 1); }
  } catch { /* no tags */ }
  const n = parseName(path);
  return { title: meta.title || n.title, artist: meta.artist || meta.album_artist || n.artist, album: meta.album || '' };
}

/** The song's audio as 16-bit stereo 44.1 kHz WAV (cached). */
export function ensureWav(song) {
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `${song.slug}.wav`);
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(song.path).mtimeMs) {
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', song.path, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', out]);
  }
  return out;
}

/** The cover: local-media/covers/<file matching the song or album>, else the file's embedded art (cached). */
export function findCover(song) {
  const words = (s) => slugify(s).split('-').filter((w) => w.length > 2);
  const want = new Set([...words(song.title), ...words(song.artist ?? '')]);
  if (existsSync(COVERS)) {
    const files = readdirSync(COVERS).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
    let best = null, bestN = 0;
    for (const f of files) { const n = words(basename(f, extname(f))).filter((w) => want.has(w)).length; if (n > bestN) { bestN = n; best = f; } }
    if (best && bestN >= 1) return join(COVERS, best);
  }
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, `${song.slug}.cover.jpg`);
  if (!existsSync(out)) {
    try { execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', song.path, '-an', '-frames:v', '1', out]); } catch { return null; }
  }
  return existsSync(out) ? out : null;
}

const WASM_PKG = join(ROOT, 'src', 'audio', 'wasm-pkg');
/** Whole-song analysis (scripts/reel/analyse.ts), cached next to the WAV. */
export function analyse(song) {
  const wav = ensureWav(song);
  const out = join(CACHE, `${song.slug}.analysis.json`);
  const src = join(ROOT, 'scripts', 'reel', 'analyse.ts');
  const bundle = join(ROOT, 'node_modules', '.cache', 'reel-analyse.mjs');
  const stale = (f, ...deps) => !existsSync(f) || deps.some((d) => statSync(d).mtimeMs > statSync(f).mtimeMs);
  if (stale(bundle, src, join(ROOT, 'src', 'engine', 'events.ts'))) {
    mkdirSync(dirname(bundle), { recursive: true });
    execFileSync(join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'), [src, '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'], { shell: process.platform === 'win32' });
  }
  if (stale(out, wav, bundle, join(WASM_PKG, 'sonora_dsp_bg.wasm'))) {
    execFileSync(process.execPath, [bundle, wav, WASM_PKG, out, song.title], { stdio: 'inherit' });
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

/** m:ss.s (Instagram's music picker start). */
export const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
