/**
 * Overlays drawn with Canvas 2D, shared by the app's exports and recordings
 * (composited onto every frame, and drawn the same way in the live preview, so
 * the preview is exactly the render) and by the reel studio (which renders each
 * layer once and composites it with ffmpeg).
 *
 * Elements: the corner mark (Glint + wordmark, ~70% Bone; always on app
 * exports), the outro end card ("made with sonora · sonoravisuals.com" in the
 * trailer's lockup style), the title card (reel line or centred cinematic),
 * text overlays (own text, timing, position, size, font, case), the
 * now-playing card (the app's toast), and the studio's style line and labels.
 * Every placement keeps inside the 9:16 safe zones (Instagram / TikTok / Shorts
 * interface: top band, bottom band, the buttons on the right).
 */

import smallMarkSvg from '../../DOCS/brand/sonora-mark-small-bone.svg?raw';
import lockupSvg from '../../DOCS/brand/sonora-lockup-bone.svg?raw';
import wordmarkSvg from '../assets/brand/sonora-wordmark-bone.svg?raw';
import instrumentUrl from '../assets/fonts/instrument-serif-latin-400-normal.woff2?url';
import frauncesUrl from '../assets/fonts/fraunces-latin-600-normal.woff2?url';
import bebasUrl from '../assets/fonts/bebas-neue-latin-400-normal.woff2?url';
import groteskUrl from '../assets/fonts/space-grotesk-latin-600-normal.woff2?url';
import interUrl from '../assets/fonts/inter-latin-opsz-normal.woff2?url';
import plex400Url from '../assets/fonts/ibm-plex-mono-latin-400-normal.woff2?url';
import plex500Url from '../assets/fonts/ibm-plex-mono-latin-500-normal.woff2?url';

// ── Tuning ──────────────────────────────────────────────────────
/** The outro end card's length (s). */
export const OUTRO_S = 2;
/** The corner mark's opacity (Bone). */
const MARK_ALPHA = 0.7;
/** Text fades (s). */
const TEXT_FADE = 0.3;
/** Title card fades (s). */
const TITLE_FADE = 0.5;
/** Now-playing card timing (the app's toast: NP_SHOW_MS). */
export const TOAST = { in: 0.45, hold: 5, out: 0.45 };
/** Style labels (studio). */
export const LABEL = { in: 0.3, hold: 1.5, out: 0.3 };
/** 9:16 safe zones as fractions of the frame (top band, bottom band, right-hand buttons from mid-height down). */
export const SAFE_9x16 = { top: 0.14, bottom: 0.24, right: 0.13, rightFrom: 0.5 };

const BONE = '236, 231, 223';
const NIGHT = '#08080A';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type TextPos = 'tl' | 'top' | 'tr' | 'center' | 'bl' | 'bottom' | 'br';
export type TextSize = 's' | 'm' | 'l' | 'xl';
export type TextCase = 'as-typed' | 'lower' | 'upper';
export type FontId = 'inter' | 'mono' | 'instrument' | 'fraunces' | 'bebas' | 'grotesk';

export const FONTS: Record<FontId, { label: string; family: string; weight: number; tracking: number }> = {
  inter: { label: 'inter display', family: 'Inter', weight: 600, tracking: -0.03 },
  mono: { label: 'plex mono', family: 'IBM Plex Mono', weight: 500, tracking: 0.04 },
  instrument: { label: 'instrument serif', family: 'Instrument Serif', weight: 400, tracking: -0.01 },
  fraunces: { label: 'fraunces', family: 'Fraunces', weight: 600, tracking: -0.02 },
  bebas: { label: 'bebas neue', family: 'Bebas Neue', weight: 400, tracking: 0.02 },
  grotesk: { label: 'space grotesk', family: 'Space Grotesk', weight: 600, tracking: -0.02 },
};
const SIZES: Record<TextSize, number> = { s: 34, m: 52, l: 80, xl: 124 };

export interface TextOverlay {
  text: string;
  /** Seconds from the export's start. */
  start: number;
  end: number;
  pos: TextPos;
  size: TextSize;
  font: FontId;
  case: TextCase;
}

export interface TitleCard {
  style: 'reel' | 'cinematic';
  title: string;
  artist: string;
  /** Seconds from the export's start. */
  in: number;
  out: number;
}

export interface NowPlayingCard { at: number; title: string; artist: string; album?: string; art?: string | null }

export interface OverlaySpec {
  size: [number, number];
  /** The window's length (s); the outro follows it. */
  duration: number;
  mark: { corner: Corner } | null;
  outro: boolean;
  title?: TitleCard | null;
  texts?: TextOverlay[];
  nowPlaying?: NowPlayingCard | null;
  /** Studio house style: the style line under the title and style labels. */
  styleLines?: { t0: number; t1: number; text: string }[];
  labels?: { t0: number; text: string }[];
}

// ── Fonts and brand images ──────────────────────────────────────
let fontsReady: Promise<void> | null = null;
/** Load every overlay font (brand and display faces), whether or not the page has ds.css. */
export function loadOverlayFonts(): Promise<void> {
  fontsReady ??= (async () => {
    const extra: [string, string, string][] = [['Instrument Serif', instrumentUrl, '400'], ['Fraunces', frauncesUrl, '600'], ['Bebas Neue', bebasUrl, '400'], ['Space Grotesk', groteskUrl, '600'],
      ['Inter', interUrl, '100 900'], ['IBM Plex Mono', plex400Url, '400'], ['IBM Plex Mono', plex500Url, '500']];
    await Promise.all(extra.map(async ([fam, url, w]) => {
      const f = new FontFace(fam, `url(${url})`, { weight: w });
      try { document.fonts.add(await f.load()); } catch { /* falls back to the brand font */ }
    }));
    await Promise.all([
      document.fonts.load('600 40px Inter'), document.fonts.load('400 40px Inter'),
      document.fonts.load('500 40px "IBM Plex Mono"'), document.fonts.load('400 40px "IBM Plex Mono"'),
    ]).catch(() => undefined);
  })();
  return fontsReady;
}

const svgImage = (src: string): Promise<HTMLImageElement> => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('svg'));
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
});
let brand: Promise<{ glint: HTMLImageElement; word: HTMLImageElement; lockup: HTMLImageElement }> | null = null;
function brandImages(): Promise<{ glint: HTMLImageElement; word: HTMLImageElement; lockup: HTMLImageElement }> {
  brand ??= Promise.all([svgImage(smallMarkSvg), svgImage(wordmarkSvg), svgImage(lockupSvg)]).then(([glint, word, lockup]) => ({ glint, word, lockup }));
  return brand;
}
const loadImage = (src: string): Promise<HTMLImageElement | null> => new Promise((ok) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => ok(null);
  img.src = src;
});

// ── Layout ──────────────────────────────────────────────────────
export interface Frame { W: number; H: number; s: number; pad: number; portrait: boolean; tall: boolean; safe: { top: number; bottom: number; right: number; rightFrom: number } }

/** Layout for a frame: scale (1 at 1080 on the short side), padding and the safe area. */
export function frameOf(W: number, H: number): Frame {
  const s = Math.min(W, H) / 1080;
  const tall = H / W > 1.6;   // 9:16 (and taller): the platforms' interface covers bands
  const safe = tall ? { top: SAFE_9x16.top * H, bottom: SAFE_9x16.bottom * H, right: SAFE_9x16.right * W, rightFrom: SAFE_9x16.rightFrom * H } : { top: 0, bottom: 0, right: 0, rightFrom: H };
  return { W, H, s, pad: 72 * s, portrait: H > W, tall, safe };
}

/** Box (x, y = top-left) for an element of size w × h at a position, inside the safe zones. */
function place(F: Frame, pos: TextPos | Corner, w: number, h: number, padK = 1): { x: number; y: number } {
  const pad = F.pad * padK;
  const top = Math.max(pad, F.safe.top + pad * 0.4);
  const bottom = F.H - Math.max(pad, F.safe.bottom + pad * 0.4) - h;
  const left = pad;
  const rightEdge = (y: number): number => F.W - pad - (F.tall && y + h > F.safe.rightFrom ? F.safe.right : 0);
  const midX = (F.W - w) / 2, midY = (F.H - h) / 2;
  switch (pos) {
    case 'tl': return { x: left, y: top };
    case 'tr': return { x: rightEdge(top) - w, y: top };
    case 'top': return { x: midX, y: top };
    case 'center': return { x: midX, y: F.tall ? Math.min(midY, bottom) : midY };
    case 'bl': return { x: left, y: bottom };
    case 'br': return { x: rightEdge(bottom) - w, y: bottom };
    case 'bottom': return { x: Math.min(midX, rightEdge(bottom) - w), y: bottom };
  }
}

// ── Drawing helpers ─────────────────────────────────────────────
const font = (f: FontId, px: number, weight?: number): string => `${weight ?? FONTS[f].weight} ${px}px "${FONTS[f].family}"`;
const applyCase = (t: string, c: TextCase): string => (c === 'lower' ? t.toLowerCase() : c === 'upper' ? t.toUpperCase() : t);

/** Wrap text to a width (explicit line breaks kept). */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && g.measureText(next).width > maxW) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}

type Painter = (g: CanvasRenderingContext2D) => void;
/** A static element rendered once into its own canvas (drawn per frame at an opacity). */
interface Sprite { canvas: HTMLCanvasElement; x: number; y: number }
function sprite(w: number, h: number, x: number, y: number, paint: Painter): Sprite {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d')!;
  paint(g);
  return { canvas: c, x: Math.round(x), y: Math.round(y) };
}
const measure = (f: string, text: string, tracking = 0): number => {
  const g = document.createElement('canvas').getContext('2d')!;
  g.font = f;
  g.letterSpacing = `${tracking}em`;
  return g.measureText(text).width;
};

// ── Elements ────────────────────────────────────────────────────
async function markSprite(F: Frame, corner: Corner): Promise<Sprite> {
  const b = await brandImages();
  const gh = 40 * F.s, wh = 21 * F.s;
  const ww = wh * (b.word.naturalWidth / Math.max(1, b.word.naturalHeight) || 5.34);
  const gap = 8 * F.s, inset = 8 * F.s;   // the small Glint's own margin (studio: -8 px)
  const w = gh - inset + gap + ww, h = gh;
  const p = place(F, corner, w, h);
  return sprite(w, h, p.x, p.y, (g) => {
    g.drawImage(b.glint, -inset / 2, 0, gh, gh);
    g.drawImage(b.word, gh - inset + gap, (gh - wh) / 2, ww, wh);
  });
}

async function outroSprite(F: Frame): Promise<Sprite> {
  const b = await brandImages();
  const lw = (F.portrait ? 0.62 : 0.4) * F.W;
  const lh = lw * (b.lockup.naturalHeight / Math.max(1, b.lockup.naturalWidth) || 100 / 684);
  const lineF = `500 ${(F.portrait ? 34 : 30) * F.s}px "IBM Plex Mono"`;
  const line = 'made with sonora · sonoravisuals.com';
  const gap = 46 * F.s;
  const total = lh + gap + 40 * F.s;
  return sprite(F.W, F.H, 0, 0, (g) => {
    const y0 = (F.H - total) / 2;
    g.drawImage(b.lockup, (F.W - lw) / 2, y0, lw, lh);
    g.font = lineF;
    g.letterSpacing = '0.04em';
    g.fillStyle = `rgba(${BONE}, 0.72)`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(line, F.W / 2, y0 + lh + gap);
  });
}

function titleSprite(F: Frame, t: TitleCard): Sprite {
  if (t.style === 'reel') {
    const text = `${t.title}${t.artist ? ` — ${t.artist}` : ''}`.toLowerCase();
    const f = `500 ${30 * F.s}px "IBM Plex Mono"`;
    const w = Math.min(F.W - 2 * F.pad, measure(f, text, 0.02) + 4), h = 40 * F.s;
    const p = place(F, 'tl', w, h);
    return sprite(w, h, p.x, p.y, (g) => { g.font = f; g.letterSpacing = '0.02em'; g.fillStyle = `rgba(${BONE}, 0.8)`; g.textBaseline = 'top'; g.fillText(text, 0, 2 * F.s, w); });
  }
  // Cinematic: the title large in the display face, the artist under it in tracked mono, centred.
  const maxW = F.W - 2 * F.pad - (F.tall ? F.safe.right : 0);
  const tg = document.createElement('canvas').getContext('2d')!;
  let px = (F.portrait ? 96 : 112) * F.s;
  tg.font = font('inter', px); tg.letterSpacing = '-0.03em';
  let lines = wrap(tg, t.title.toLowerCase(), maxW);
  while (lines.length > 2 && px > 40 * F.s) { px *= 0.88; tg.font = font('inter', px); lines = wrap(tg, t.title.toLowerCase(), maxW); }
  const lh = px * 1.02;
  const af = `500 ${26 * F.s}px "IBM Plex Mono"`;
  const h = lines.length * lh + (t.artist ? 30 * F.s + 34 * F.s : 0);
  const y = F.tall ? Math.min((F.H - h) / 2, F.H - F.safe.bottom - F.pad - h) : (F.H - h) / 2;
  return sprite(F.W, h + 8, 0, y, (g) => {
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = `rgb(${BONE})`;
    g.font = font('inter', px); g.letterSpacing = '-0.03em';
    lines.forEach((l, i) => g.fillText(l, F.W / 2, i * lh));
    if (t.artist) {
      g.font = af; g.letterSpacing = '0.14em'; g.fillStyle = `rgba(${BONE}, 0.7)`;
      g.fillText(t.artist.toUpperCase(), F.W / 2, lines.length * lh + 30 * F.s);
    }
  });
}

function textSprite(F: Frame, t: TextOverlay): Sprite {
  const px = SIZES[t.size] * F.s;
  const fd = FONTS[t.font];
  const tracking = t.case === 'upper' ? Math.max(fd.tracking, 0.06) : fd.tracking;
  const maxW = F.W - 2 * F.pad - (F.tall ? F.safe.right : 0);
  const tg = document.createElement('canvas').getContext('2d')!;
  tg.font = font(t.font, px); tg.letterSpacing = `${tracking}em`;
  const lines = wrap(tg, applyCase(t.text, t.case), maxW);
  const lh = px * (t.font === 'bebas' ? 1.0 : 1.12);
  const w = Math.min(maxW, Math.max(...lines.map((l) => tg.measureText(l).width)) + 4);
  const h = lines.length * lh + px * 0.12;
  const p = place(F, t.pos, w, h);
  const align: CanvasTextAlign = t.pos === 'tr' || t.pos === 'br' ? 'right' : t.pos === 'top' || t.pos === 'center' || t.pos === 'bottom' ? 'center' : 'left';
  const ax = align === 'left' ? 0 : align === 'right' ? w : w / 2;
  return sprite(w, h, p.x, p.y, (g) => {
    g.font = font(t.font, px); g.letterSpacing = `${tracking}em`; g.fillStyle = `rgb(${BONE})`;
    g.textAlign = align; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, ax, i * lh, w));
  });
}

async function nowPlayingSprite(F: Frame, n: NowPlayingCard): Promise<Sprite> {
  const k = (F.portrait ? 1.7 : 1.3) * F.s;
  const art = n.art ? await loadImage(n.art) : null;
  const aw = art ? 56 * k : 0, gap = art ? 16 * k : 0;
  const tf = `600 ${20 * k}px Inter`, mf = `400 ${11 * k}px "IBM Plex Mono"`;
  const meta = [n.artist, n.album].filter(Boolean).join(' · ').toUpperCase();
  const tw = Math.min(F.W * 0.6, Math.max(measure(tf, n.title, -0.02), measure(mf, meta, 0.12)) + 4);
  const w = aw + gap + tw, h = Math.max(aw, 50 * k);
  const pos: Corner = F.portrait ? 'bl' : 'bl';
  const p = place(F, pos, w, h);
  // 9:16: mid-left, a little over half-way down (studio house style); 16:9 / 1:1 / 4:5: bottom left.
  const y = F.tall ? Math.min(F.H * 0.61, F.H - F.safe.bottom - F.pad - h) : p.y;
  return sprite(w, h, p.x, y, (g) => {
    if (art) {
      const s = Math.min(art.naturalWidth, art.naturalHeight);
      g.drawImage(art, (art.naturalWidth - s) / 2, (art.naturalHeight - s) / 2, s, s, 0, (h - aw) / 2, aw, aw);
    }
    g.textBaseline = 'top';
    g.font = tf; g.letterSpacing = '-0.02em'; g.fillStyle = `rgb(${BONE})`;
    const ty = (h - (20 * k + 4 * k + 13 * k)) / 2;
    g.fillText(n.title, aw + gap, ty, tw);
    g.font = mf; g.letterSpacing = '0.12em'; g.fillStyle = `rgba(${BONE}, 0.4)`;
    g.fillText(meta, aw + gap, ty + 24 * k + 4 * k, tw);
  });
}

function monoLineSprite(F: Frame, text: string, px: number, alpha: number, at: 'styleline' | 'label'): Sprite {
  const f = `${at === 'label' ? 400 : 400} ${px * F.s}px "IBM Plex Mono"`;
  const w = Math.min(F.W - 2 * F.pad, measure(f, text, 0.02) + 4), h = px * 1.3 * F.s;
  let x = F.pad, y: number;
  if (at === 'styleline') y = place(F, 'tl', w, h).y + 46 * F.s;
  else { y = F.tall ? F.H * (1440 / 1920) - h : F.H - 64 * F.s - h; x = F.pad; }
  return sprite(w, h, x, y, (g) => { g.font = f; g.letterSpacing = '0.02em'; g.fillStyle = `rgba(${BONE}, ${alpha})`; g.textBaseline = 'top'; g.fillText(text, 0, 0, w); });
}

// ── The overlay for one export ──────────────────────────────────
interface Timed { sp: Sprite; t0: number; t1: number; fin: number; fout: number }

export interface Overlay {
  /** Total length (window + outro). */
  readonly length: number;
  /** Draw every overlay visible at t (seconds from the export's start) onto a frame of the spec's size. */
  draw(g: CanvasRenderingContext2D, t: number): void;
  /** Night cover over the picture at t (0..1): the picture fades out under the outro. */
  night(t: number): number;
}

const fadeAt = (t: number, t0: number, t1: number, fin: number, fout: number): number => {
  if (t < t0 || t > t1) return 0;
  const a = fin > 0 ? Math.min(1, (t - t0) / fin) : 1;
  const b = fout > 0 ? Math.min(1, (t1 - t) / fout) : 1;
  return Math.max(0, Math.min(a, b));
};

/** Build an export's overlay (fonts, brand images and every element rendered once). */
export async function createOverlay(spec: OverlaySpec): Promise<Overlay> {
  await loadOverlayFonts();
  const F = frameOf(spec.size[0], spec.size[1]);
  const D = spec.duration;
  const length = D + (spec.outro ? OUTRO_S : 0);
  const items: Timed[] = [];
  if (spec.title && spec.title.title) {
    const t = spec.title;
    items.push({ sp: titleSprite(F, t), t0: t.in, t1: Math.min(D, t.out), fin: t.in > 0.05 ? TITLE_FADE : 0, fout: t.out < D - 0.05 ? TITLE_FADE : 0 });
  }
  for (const s of spec.styleLines ?? []) items.push({ sp: monoLineSprite(F, s.text, 22, 0.5, 'styleline'), t0: s.t0, t1: s.t1, fin: 0, fout: 0 });
  for (const l of spec.labels ?? []) items.push({ sp: monoLineSprite(F, l.text, F.tall ? 24 : 22, 0.6, 'label'), t0: l.t0, t1: l.t0 + LABEL.in + LABEL.hold + LABEL.out, fin: LABEL.in, fout: LABEL.out });
  for (const t of spec.texts ?? []) if (t.text.trim() && t.end > t.start) items.push({ sp: textSprite(F, t), t0: t.start, t1: Math.min(D, t.end), fin: TEXT_FADE, fout: TEXT_FADE });
  if (spec.nowPlaying && spec.nowPlaying.title) {
    const n = spec.nowPlaying;
    items.push({ sp: await nowPlayingSprite(F, n), t0: n.at, t1: Math.min(D, n.at + TOAST.in + TOAST.hold + TOAST.out), fin: TOAST.in, fout: TOAST.out });
  }
  const mark = spec.mark ? await markSprite(F, spec.mark.corner) : null;
  const outro = spec.outro ? await outroSprite(F) : null;
  const night = (t: number): number => (outro && t > D ? Math.min(1, (t - D) / 0.6) : 0);
  return {
    length,
    night,
    draw(g, t) {
      g.save();
      for (const it of items) {
        const a = fadeAt(t, it.t0, it.t1, it.fin, it.fout);
        if (a <= 0) continue;
        g.globalAlpha = a;
        g.drawImage(it.sp.canvas, it.sp.x, it.sp.y);
      }
      // The mark stays through the picture and gives way to the outro's lockup.
      if (mark) {
        const a = outro ? 1 - Math.min(1, Math.max(0, (t - D) / 0.5)) : 1;
        if (a > 0) { g.globalAlpha = MARK_ALPHA * a; g.drawImage(mark.canvas, mark.x, mark.y); }
      }
      if (outro && t > D) {
        g.globalAlpha = 1;
        const n = night(t);
        if (n > 0) { g.fillStyle = NIGHT; g.globalAlpha = n; g.fillRect(0, 0, F.W, F.H); }
        const a = Math.min(1, Math.max(0, (t - D - 0.25) / 0.6));
        if (a > 0) { g.globalAlpha = a; g.drawImage(outro.canvas, 0, 0); }
      }
      g.restore();
    },
  };
}

/** The safe zones drawn as guides (preview only): shaded bands and dashed edges. */
export function drawSafeGuides(g: CanvasRenderingContext2D, W: number, H: number): void {
  const F = frameOf(W, H);
  if (!F.tall) return;
  g.save();
  g.fillStyle = `rgba(${BONE}, 0.07)`;
  g.strokeStyle = `rgba(${BONE}, 0.35)`;
  g.setLineDash([6, 5]);
  g.lineWidth = 1;
  g.fillRect(0, 0, W, F.safe.top); g.beginPath(); g.moveTo(0, F.safe.top + 0.5); g.lineTo(W, F.safe.top + 0.5); g.stroke();
  g.fillRect(0, H - F.safe.bottom, W, F.safe.bottom); g.beginPath(); g.moveTo(0, H - F.safe.bottom + 0.5); g.lineTo(W, H - F.safe.bottom + 0.5); g.stroke();
  g.fillRect(W - F.safe.right, F.safe.rightFrom, F.safe.right, H - F.safe.bottom - F.safe.rightFrom);
  g.beginPath(); g.moveTo(W - F.safe.right + 0.5, F.safe.rightFrom); g.lineTo(W - F.safe.right + 0.5, H - F.safe.bottom); g.stroke();
  g.restore();
}

/** Studio layers: one element alone at full opacity (rendered once, composited by ffmpeg). */
export type StudioLayer =
  | { kind: 'title'; text: string }
  | { kind: 'styleline'; text: string }
  | { kind: 'mark' }
  | { kind: 'label'; text: string }
  | { kind: 'toast'; title: string; artist: string; album?: string; art: string }
  | { kind: 'card'; line: string }
  | { kind: 'text'; text: string }
  | { kind: 'slide'; text: string; sub?: string };

/** Draw one studio layer into a canvas of the frame's size (transparent elsewhere). */
export async function drawStudioLayer(g: CanvasRenderingContext2D, W: number, H: number, l: StudioLayer, alpha = 1): Promise<void> {
  await loadOverlayFonts();
  const F = frameOf(W, H);
  let sp: Sprite;
  if (l.kind === 'title') {
    const f = `500 ${30 * F.s}px "IBM Plex Mono"`;
    const w = Math.min(W - 2 * F.pad, measure(f, l.text, 0.02) + 4);
    sp = sprite(w, 40 * F.s, F.pad, studioTop(F), (c) => { c.font = f; c.letterSpacing = '0.02em'; c.fillStyle = `rgba(${BONE}, 0.8)`; c.textBaseline = 'top'; c.fillText(l.text, 0, 2 * F.s, w); });
  } else if (l.kind === 'styleline') {
    const f = `400 ${22 * F.s}px "IBM Plex Mono"`;
    const w = Math.min(W - 2 * F.pad, measure(f, l.text, 0.02) + 4);
    sp = sprite(w, 30 * F.s, F.pad, studioTop(F) + 46 * F.s, (c) => { c.font = f; c.letterSpacing = '0.02em'; c.fillStyle = `rgba(${BONE}, 0.5)`; c.textBaseline = 'top'; c.fillText(l.text, 0, 0, w); });
  } else if (l.kind === 'label') sp = monoLineSprite(F, l.text, F.portrait ? 24 : 22, 0.6, 'label');
  else if (l.kind === 'mark') {
    const m = await markSprite({ ...F, safe: { top: 0, bottom: 0, right: 0, rightFrom: H } }, 'tr');
    sp = { ...m, y: Math.round(studioTop(F) + 2 * F.s) };
    g.save(); g.globalAlpha = alpha * 0.82; g.drawImage(sp.canvas, sp.x, sp.y); g.restore();
    return;
  } else if (l.kind === 'toast') {
    const n = await nowPlayingSprite(F, { at: 0, title: l.title, artist: l.artist, album: l.album, art: l.art || null });
    sp = { ...n, y: Math.round(F.portrait ? (H * 1170) / 1920 : 60 * F.s) };
  } else if (l.kind === 'card') {
    const b = await brandImages();
    const lw = (F.portrait ? 0.56 : 0.44) * W, lh = lw * (100 / 684);
    const lf = `600 ${(F.portrait ? 64 : 58) * F.s}px Inter`;
    sp = sprite(W, H, 0, 0, (c) => {
      const total = lh + 44 * F.s + 64 * F.s, y0 = (H - total) / 2;
      c.drawImage(b.lockup, (W - lw) / 2, y0, lw, lh);
      c.font = lf; c.letterSpacing = '-0.03em'; c.fillStyle = `rgb(${BONE})`; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(l.line, W / 2, y0 + lh + 44 * F.s);
    });
  } else if (l.kind === 'text') sp = textSprite(F, { text: l.text, start: 0, end: 1, pos: 'center', size: 'm', font: 'inter', case: 'lower' });
  else {
    const b = await brandImages();
    const tf = font('inter', 58 * F.s), sf = `400 ${24 * F.s}px "IBM Plex Mono"`;
    sp = sprite(W, H, 0, 0, (c) => {
      c.textBaseline = 'bottom';
      const tg = c; tg.font = tf; tg.letterSpacing = '-0.03em';
      const lines = wrap(tg, l.text.toLowerCase(), W - 2 * F.pad);
      let y = H - 96 * F.s - (l.sub ? 42 * F.s : 0);
      c.fillStyle = `rgb(${BONE})`;
      for (let i = lines.length - 1; i >= 0; i--) { c.fillText(lines[i], F.pad, y); y -= 58 * F.s * 1.04; }
      if (l.sub) { c.font = sf; c.letterSpacing = '0.02em'; c.fillStyle = `rgba(${BONE}, 0.7)`; c.fillText(l.sub.toLowerCase(), F.pad, H - 96 * F.s); }
      const lw = 40 * F.s * 6.84;
      c.drawImage(b.lockup, F.pad + 12 * F.s, 84 * F.s, lw, lw * (100 / 684));
    });
  }
  g.save(); g.globalAlpha = alpha; g.drawImage(sp.canvas, sp.x, sp.y); g.restore();
}
const studioTop = (F: Frame): number => (F.portrait ? (F.H * 300) / 1920 : 64 * F.s);
