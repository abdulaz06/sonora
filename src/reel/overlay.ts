/**
 * Reel studio overlays (local tool, never in the app or the site): renders one
 * transparent layer at a time — the song title, the style line, the mark, a
 * style label, the app's real now-playing toast, the lockup card, a text card
 * — for scripts/reel/render.mjs to screenshot and composite. House style:
 * lowercase IBM Plex Mono for the lines, Bone only, inside Instagram's safe zones.
 */

import '../ui/ds/ds.css';
import '../ui/screens/screens.css';
import { lockup } from '../ui/screens/brand';
import { nowPlayingContent } from '../ui/screens/hud';
import { h, svg } from '../ui/ds/dom';
import smallMark from '../../DOCS/brand/sonora-mark-small-bone.svg?raw';
import wordmark from '../assets/brand/sonora-wordmark-bone.svg?raw';

export type Layer =
  | { kind: 'title'; text: string }
  | { kind: 'styleline'; text: string }
  | { kind: 'mark' }
  | { kind: 'label'; text: string }
  | { kind: 'toast'; title: string; artist: string; album?: string; art: string }
  | { kind: 'card'; line: string }
  | { kind: 'text'; text: string }
  | { kind: 'slide'; text: string; sub?: string };

/** Layout in output pixels for the frame size (9:16 reels, 16:9 trailers, 4:5 carousel). */
function layout(w: number, h: number): { portrait: boolean; pad: number; top: number; labelBottom: number; toastTop: number; toastScale: number; s: number } {
  const portrait = h > w;
  const s = Math.min(w, h) / 1080;   // 1 at 1080 wide (reels) / 1080 tall (trailers)
  return portrait
    ? { portrait, pad: 72 * s, top: (h * 300) / 1920, labelBottom: h - (h * 1440) / 1920, toastTop: (h * 1170) / 1920, toastScale: 1.7 * s, s }
    : { portrait, pad: 72 * s, top: 64 * s, labelBottom: 64 * s, toastTop: 60 * s, toastScale: 1.3 * s, s };
}

const BONE = '236, 231, 223';
const mono = (size: number, alpha: number, weight = 500): Partial<CSSStyleDeclaration> => ({
  fontFamily: 'var(--f-mono)', fontSize: `${size}px`, fontWeight: String(weight), color: `rgba(${BONE}, ${alpha})`,
  letterSpacing: '0.02em', textTransform: 'lowercase', whiteSpace: 'nowrap', lineHeight: '1.2',
});

function render(l: Layer, keep = false): void {
  const W = window.innerWidth, H = window.innerHeight;
  const L = layout(W, H);
  if (!keep) document.body.replaceChildren();
  Object.assign(document.documentElement.style, { background: 'transparent' });
  Object.assign(document.body.style, { margin: '0', width: `${W}px`, height: `${H}px`, background: 'transparent', overflow: 'hidden', position: 'relative' });
  const abs = (el: HTMLElement, st: Partial<CSSStyleDeclaration>): HTMLElement => { Object.assign(el.style, { position: 'absolute', ...st }); document.body.append(el); return el; };
  if (l.kind === 'title') abs(h('div', null, l.text), { left: `${L.pad}px`, top: `${L.top}px`, ...mono(30 * L.s, 0.8) });
  else if (l.kind === 'styleline') abs(h('div', null, l.text), { left: `${L.pad}px`, top: `${L.top + 46 * L.s}px`, ...mono(22 * L.s, 0.5, 400) });
  else if (l.kind === 'label') abs(h('div', null, l.text), { left: `${L.pad}px`, bottom: `${L.labelBottom}px`, ...mono((L.portrait ? 24 : 22) * L.s, 0.6, 400) });
  else if (l.kind === 'mark') {
    // Small sizes use the heavier small Glint (brand sheet: ≤ 48 px).
    const g = svg(smallMark.replace(/#ECE7DF/gi, 'currentColor'));
    const w = svg(wordmark.replace(/#ECE7DF/gi, 'currentColor'));
    Object.assign(g.style, { height: `${40 * L.s}px`, width: `${40 * L.s}px`, margin: `${-8 * L.s}px ${-4 * L.s}px` });
    Object.assign(w.style, { height: `${21 * L.s}px`, width: 'auto' });
    const m = h('div', null, g, w);
    abs(m, { right: `${L.pad}px`, top: `${L.top + 2 * L.s}px`, color: `rgba(${BONE}, 0.82)`, display: 'flex', alignItems: 'center', gap: `${8 * L.s}px` });
  } else if (l.kind === 'toast') {
    // The app's own now-playing toast, scaled for the frame.
    const t = h('div', { class: 'np-overlay s-root show top-left' }, ...nowPlayingContent({ art: l.art, title: l.title, artist: l.artist, album: l.album ?? '' }).filter((x): x is Node => !!x));
    abs(t, { left: `${L.pad}px`, top: `${L.toastTop}px`, transform: `scale(${L.toastScale})`, transformOrigin: 'top left', transition: 'none', maxWidth: `${(W - 2 * L.pad - 140 * L.s) / L.toastScale}px` });
  } else if (l.kind === 'card') {
    const box = abs(h('div'), { inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: `${44 * L.s}px`, color: `rgb(${BONE})` });
    const lk = lockup();
    lk.style.fontSize = `${(L.portrait ? 120 : 132) * L.s}px`;
    box.append(lk, h('div', { style: { fontFamily: 'var(--f-display)', fontWeight: '600', fontVariationSettings: "'opsz' 32", fontSize: `${(L.portrait ? 64 : 58) * L.s}px`, letterSpacing: '-0.03em' } }, l.line));
  } else if (l.kind === 'text') {
    abs(h('div', null, l.text), { left: `${L.pad}px`, right: `${L.pad}px`, top: '50%', transform: 'translateY(-50%)', textAlign: 'center', fontFamily: 'var(--f-display)', fontWeight: '600', fontVariationSettings: "'opsz' 32", fontSize: `${64 * L.s}px`, lineHeight: '1.08', letterSpacing: '-0.03em', color: `rgb(${BONE})`, textTransform: 'lowercase' });
  } else if (l.kind === 'slide') {
    const box = abs(h('div'), { left: `${L.pad}px`, right: `${L.pad}px`, bottom: `${96 * L.s}px`, display: 'flex', flexDirection: 'column', gap: `${18 * L.s}px` });
    box.append(h('div', { style: { fontFamily: 'var(--f-display)', fontWeight: '600', fontVariationSettings: "'opsz' 32", fontSize: `${58 * L.s}px`, lineHeight: '1.04', letterSpacing: '-0.03em', color: `rgb(${BONE})`, textTransform: 'lowercase' } }, l.text));
    if (l.sub) box.append(h('div', { style: mono(24 * L.s, 0.7, 400) }, l.sub));
    const mk = lockup();
    abs(mk, { left: `${L.pad + 12 * L.s}px`, top: `${84 * L.s}px`, fontSize: `${40 * L.s}px` });
  }
}

declare global { interface Window { __overlay?: { render(l: Layer): Promise<void>; renderMany(ls: { layer: Layer; opacity: number }[]): void } } }
window.__overlay = {
  /** Studio preview: several layers at once, each at an opacity (its fade). */
  renderMany(ls) {
    document.body.replaceChildren();
    for (const { layer, opacity } of ls) {
      const before = document.body.childElementCount;
      render(layer, true);
      for (let i = before; i < document.body.childElementCount; i++) (document.body.children[i] as HTMLElement).style.opacity = String(opacity);
    }
  },
  async render(l) {
    render(l);
    await document.fonts.ready;
    const imgs = [...document.images];
    await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => undefined))));
  },
};
