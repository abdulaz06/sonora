/**
 * Album-art colours: the palette from the cover of what's playing.
 *
 * The cover is downscaled (the caller draws it at COVER_SIZE²), its pixels are
 * clustered in OKLab (k-means, deterministic start), and the clusters are
 * ranked by area × chroma with near-black, near-white and grey left out. The
 * dominant vivid colour becomes the primary; an analogous cover colour the
 * secondary; the most distinct second vivid hue the accent. The hues then go
 * through the same OKLCH rules as the presets and custom hue
 * (paletteFromCover: matched lightness, full chroma, olive / cyan bands), so
 * an album palette is never muddy, grey or blown out. A grey or black-and-white
 * cover gives null: the user's own palette stays.
 *
 * Pure (no DOM): the app and the tests feed it RGBA pixels.
 */

import { paletteFromCover, type CoverHues, type Palette } from './color-engine';
import { oklabToOklch, srgbToOklab, type OKLab, type OKLCH } from './oklch';

// ── Tuning ──────────────────────────────────────────────────────
/** Side of the square the cover is drawn at before clustering (px). */
export const COVER_SIZE = 64;
/** k-means clusters and iterations. */
const K = 10;
const ITERS = 14;
/** Neutral pixels / clusters: grey below this chroma, near-black below
 * DARK_L, near-white above LIGHT_L when also below LIGHT_C. */
const GREY_C = 0.045;
const DARK_L = 0.2;
const LIGHT_L = 0.93;
const LIGHT_C = 0.08;
/** A colour counts as vivid from this chroma, and needs this share of the
 * cover (smaller specks are noise or tiny logos). */
const VIVID_C = 0.06;
const MIN_SHARE = 0.015;
/** Vivid clusters within this many degrees of hue are one colour (an object
 * in light and in shadow). */
const HUE_MERGE = 16;
/** No vivid colour at all: a tinted cover (sepia, a dark duotone) still gives
 * a palette from its hue when its mean chroma reaches this; below, it's grey. */
const TINT_MEAN_C = 0.028;
/** The accent must score at least this share of the primary's score. */
const ACCENT_MIN_SCORE = 0.08;

export interface CoverColour {
  /** OKLCH of the cluster mean. */
  lch: OKLCH;
  /** Share of the cover (0..1). */
  share: number;
  /** area × chroma. */
  score: number;
  /** Near-black, near-white or grey. */
  neutral: boolean;
}

export interface AlbumExtraction {
  /** Every cluster, biggest first (review sheets). */
  colours: CoverColour[];
  /** Vivid hue groups, best score first. */
  vivid: CoverColour[];
  kind: 'vivid' | 'tinted' | 'grey';
  /** The cover hues used (null for a grey cover). */
  hues: CoverHues | null;
  palette: Palette | null;
}

/** Cluster and rank a cover's colours, and build its palette (null palette
 * when the cover is grey / black-and-white). `rgba` is width × height × 4. */
export function extractAlbum(rgba: ArrayLike<number>, width: number, height: number): AlbumExtraction {
  const labs: OKLab[] = [];
  for (let i = 0; i < width * height; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    labs.push(srgbToOklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]));
  }
  if (labs.length < 16) return { colours: [], vivid: [], kind: 'grey', hues: null, palette: null };
  const clusters = kmeans(labs, K, ITERS);
  const colours: CoverColour[] = clusters
    .filter((c) => c.n > 0)
    .map((c) => {
      const lch = oklabToOklch(c.mean);
      const share = c.n / labs.length;
      return { lch, share, score: share * lch[1], neutral: isNeutral(lch) };
    })
    .sort((a, b) => b.share - a.share);

  const vivid = mergeHues(colours.filter((c) => !c.neutral && c.lch[1] >= VIVID_C))
    .filter((c) => c.share >= MIN_SHARE)
    .sort((a, b) => b.score - a.score);

  if (vivid.length) {
    const hues = pickHues(vivid);
    return { colours, vivid, kind: 'vivid', hues, palette: paletteFromCover(hues) };
  }
  // No vivid colour: a tinted cover keeps its hue, a grey one gives nothing.
  let a = 0, b = 0, w = 0;
  for (const l of labs) {
    if (l[0] < DARK_L * 0.6 || l[0] > 0.97) continue;
    a += l[1]; b += l[2]; w++;
  }
  const mean = w ? Math.hypot(a / w, b / w) : 0;
  if (w >= labs.length * 0.2 && mean >= TINT_MEAN_C) {
    const hue = ((Math.atan2(b / w, a / w) * 180) / Math.PI + 360) % 360;
    const hues: CoverHues = { primary: hue };
    return { colours, vivid, kind: 'tinted', hues, palette: paletteFromCover(hues) };
  }
  return { colours, vivid, kind: 'grey', hues: null, palette: null };
}

function isNeutral([l, c]: OKLCH): boolean {
  return c < GREY_C || l < DARK_L || (l > LIGHT_L && c < LIGHT_C);
}

/** Primary: the best-scoring vivid colour. Secondary: the best one 18–62°
 * away (analogous). Accent: the best one ≥ 45° away that isn't the
 * secondary, weighted toward distinct hues (score × distance). */
function pickHues(vivid: CoverColour[]): CoverHues {
  const p = vivid[0];
  const h = p.lch[2];
  const out: CoverHues = { primary: h };
  const dist = (c: CoverColour): number => Math.abs(angDiff(c.lch[2], h));
  const sec = vivid.slice(1).find((c) => dist(c) >= 18 && dist(c) <= 62);
  if (sec) out.secondary = sec.lch[2];
  let best: CoverColour | null = null, bestV = 0;
  for (const c of vivid.slice(1)) {
    if (c === sec || dist(c) < 45 || c.score < p.score * ACCENT_MIN_SCORE) continue;
    const v = c.score * Math.min(1, dist(c) / 90);
    if (v > bestV) { bestV = v; best = c; }
  }
  if (best) out.accent = best.lch[2];
  return out;
}

/** Vivid clusters of nearly the same hue as one colour (share-weighted). */
function mergeHues(list: CoverColour[]): CoverColour[] {
  const groups: CoverColour[] = [];
  for (const c of [...list].sort((a, b) => b.score - a.score)) {
    const g = groups.find((x) => Math.abs(angDiff(x.lch[2], c.lch[2])) <= HUE_MERGE);
    if (!g) { groups.push({ ...c, lch: [...c.lch] as OKLCH }); continue; }
    const s = g.share + c.share;
    // Hue follows the stronger member; lightness and chroma are averaged by area.
    g.lch = [(g.lch[0] * g.share + c.lch[0] * c.share) / s, (g.lch[1] * g.share + c.lch[1] * c.share) / s, g.lch[2]];
    g.share = s;
    g.score = s * g.lch[1];
  }
  return groups;
}

interface Cluster { mean: OKLab; n: number }

/** k-means in OKLab, started deterministically (farthest-point from the mean
 * pixel), so the same cover always gives the same palette. */
function kmeans(px: OKLab[], k: number, iters: number): Cluster[] {
  const n = px.length;
  const cents: OKLab[] = [];
  let m: OKLab = [0, 0, 0];
  for (const p of px) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }
  m = [m[0] / n, m[1] / n, m[2] / n];
  const dmin = new Float64Array(n).fill(Infinity);
  let seed = m;
  for (let c = 0; c < Math.min(k, n); c++) {
    // Farthest pixel from the centres so far (the mean for the first pick).
    let far = 0, farD = -1;
    for (let i = 0; i < n; i++) {
      const d = dist2(px[i], seed);
      if (d < dmin[i]) dmin[i] = d;
      if (dmin[i] > farD) { farD = dmin[i]; far = i; }
    }
    if (c === 0) { dmin.fill(Infinity); seed = px[far]; cents.push([...px[far]] as OKLab); continue; }
    seed = px[far];
    cents.push([...px[far]] as OKLab);
  }
  const assign = new Int32Array(n);
  const sums = cents.map(() => [0, 0, 0, 0]);
  for (let it = 0; it < iters; it++) {
    for (const s of sums) s.fill(0);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const d = dist2(px[i], cents[c]);
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
      const s = sums[best];
      s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
    }
    for (let c = 0; c < cents.length; c++) if (sums[c][3]) cents[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    if (it > 0 && moved === 0) break;
  }
  return cents.map((mean, c) => ({ mean, n: sums[c][3] }));
}

/** Chroma counts double: two colours of one lightness but different hues are
 * further apart, to the eye and for a palette, than OKLab's plain distance says. */
function dist2(a: OKLab, b: OKLab): number {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + 4 * (da * da + db * db);
}

function angDiff(a: number, b: number): number {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}
