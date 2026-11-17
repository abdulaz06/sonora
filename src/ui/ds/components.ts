/**
 * Design-system components. Each returns a plain element (plus a small
 * handle where it holds state). Styling lives in ds.css.
 */

import { h, svg } from './dom';
import { ICONS } from './icons';

export type Icon = keyof typeof ICONS;

// ── Button ──────────────────────────────────────────────────────
export interface ButtonOpts {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: Icon;
  iconAfter?: Icon;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}
export function button(label: string, o: ButtonOpts = {}): HTMLButtonElement {
  const cls = ['s-btn'];
  if (o.variant && o.variant !== 'default') cls.push(`s-btn--${o.variant}`);
  if (o.size && o.size !== 'md') cls.push(`s-btn--${o.size}`);
  if (!label) cls.push('s-btn--icon');
  const b = h('button', { class: cls.join(' '), type: 'button', title: o.title, 'aria-label': label ? null : o.title });
  if (o.icon) b.append(svg(ICONS[o.icon]));
  if (label) b.append(h('span', null, label));
  if (o.iconAfter) { const i = svg(ICONS[o.iconAfter]); i.classList.add('s-arrow'); b.append(i); }
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

export const icon = (name: Icon): SVGSVGElement => svg(ICONS[name]);

// ── Segmented control ───────────────────────────────────────────
export interface SegOption<T extends string> { value: T; label: string; title?: string }
export interface Segmented<T extends string> { el: HTMLDivElement; set(v: T): void }
export function segmented<T extends string>(opts: SegOption<T>[], value: T, onChange: (v: T) => void, ariaLabel = ''): Segmented<T> {
  const el = h('div', { class: 's-seg', role: 'group', 'aria-label': ariaLabel || null });
  const btns = opts.map((o) => {
    const b = h('button', { type: 'button', title: o.title ?? null, 'aria-pressed': String(o.value === value) }, o.label);
    b.addEventListener('click', () => { set(o.value); onChange(o.value); });
    el.append(b);
    return b;
  });
  function set(v: T): void { btns.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i].value === v))); }
  return { el, set };
}

// ── Slider ──────────────────────────────────────────────────────
export interface SliderOpts {
  min: number; max: number; step?: number; value: number;
  ends?: [string, string] | [string, string, string];
  /** Mark a default position with a tick. */
  tick?: number;
  hue?: boolean;
  ariaLabel?: string;
  onInput: (v: number) => void;
  onCommit?: (v: number) => void;
  onReset?: () => void;
}
export interface Slider { el: HTMLDivElement; input: HTMLInputElement; set(v: number): void }
export function slider(o: SliderOpts): Slider {
  const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step ?? 1, value: o.value, 'aria-label': o.ariaLabel ?? null });
  const wrap = h('div', { class: `s-slider${o.hue ? ' s-slider--hue' : ''}` }, input);
  const paint = (): void => {
    const p = ((Number(input.value) - o.min) / (o.max - o.min)) * 100;
    input.style.setProperty('--p', `${p}%`);
  };
  if (o.tick !== undefined) {
    const p = ((o.tick - o.min) / (o.max - o.min)) * 100;
    wrap.append(h('i', { class: 's-tick', style: { left: `calc(5.5px + (100% - 11px) * ${p / 100})` } }));
  }
  input.addEventListener('input', () => { paint(); o.onInput(Number(input.value)); });
  input.addEventListener('change', () => o.onCommit?.(Number(input.value)));
  if (o.onReset) input.addEventListener('dblclick', () => o.onReset?.());
  paint();
  const el = h('div', null, wrap);
  if (o.ends) {
    const e = h('div', { class: 's-slider-ends' });
    for (const t of o.ends) e.append(h('span', null, t));
    el.append(e);
  }
  return { el, input, set(v: number) { if (document.activeElement === input) return; input.value = String(v); paint(); } };
}

// ── Toggle ──────────────────────────────────────────────────────
export interface Toggle { el: HTMLLabelElement; input: HTMLInputElement; set(on: boolean): void }
export function toggle(label: string, on: boolean, onChange: (on: boolean) => void): Toggle {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 's-toggle' }, input, h('span', { class: 's-sw' }), label ? h('span', { class: 's-label' }, label) : null);
  return { el, input, set(v: boolean) { input.checked = v; } };
}

// ── Select ──────────────────────────────────────────────────────
export interface SelectOption { value: string; label: string }
export interface Select { el: HTMLLabelElement; select: HTMLSelectElement; setOptions(opts: SelectOption[], value: string): void }
export function select(opts: SelectOption[], value: string, onChange: (v: string) => void, ariaLabel = ''): Select {
  const sel = h('select', { 'aria-label': ariaLabel || null });
  sel.addEventListener('change', () => onChange(sel.value));
  const el = h('label', { class: 's-select' }, sel, icon('chevronDown'));
  const setOptions = (o: SelectOption[], v: string): void => {
    sel.replaceChildren(...o.map((x) => h('option', { value: x.value }, x.label)));
    sel.value = v;
  };
  setOptions(opts, value);
  return { el, select: sel, setOptions };
}

// ── Media: still with an optional loop that plays on demand ─────
export interface MediaSrc { still: string; stillSmall?: string; loop?: string; alt?: string }
export interface Media { el: HTMLDivElement; play(): void; stop(): void; set(src: MediaSrc): void }
export function media(src: MediaSrc, opts: { large?: boolean; eager?: boolean } = {}): Media {
  const el = h('div', { class: 's-media' });
  let img = h('img', { alt: src.alt ?? '', decoding: 'async', loading: opts.eager ? 'eager' : 'lazy', draggable: 'false' });
  let video: HTMLVideoElement | null = null;
  let cur = src;
  let wantPlay = false;
  const build = (s: MediaSrc): void => {
    cur = s;
    img = h('img', { alt: s.alt ?? '', decoding: 'async', loading: opts.eager ? 'eager' : 'lazy', draggable: 'false' });
    img.src = !opts.large && s.stillSmall ? s.stillSmall : s.still;
    video = null;
    el.replaceChildren(img);
    if (wantPlay) play();
  };
  function play(): void {
    wantPlay = true;
    if (!cur.loop) return;
    if (!video) {
      video = h('video', { muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
      video.muted = true;
      video.src = cur.loop;
      el.append(video);
    }
    const v = video;
    void v.play().then(() => { if (wantPlay) el.classList.add('is-playing'); }).catch(() => undefined);
  }
  function stop(): void {
    wantPlay = false;
    el.classList.remove('is-playing');
    const v = video;
    if (v) window.setTimeout(() => { if (!wantPlay) v.pause(); }, 450);
  }
  build(src);
  return { el, play, stop, set: build };
}

// ── Thumbnail card ──────────────────────────────────────────────
export interface ThumbOpts {
  media: MediaSrc;
  title: string;
  sub?: string;
  mark?: string;
  selected?: boolean;
  /** Play the loop on hover / focus (default true). */
  hoverPlay?: boolean;
  onClick?: () => void;
  onFocus?: () => void;
}
export interface Thumb { el: HTMLButtonElement; media: Media; setSelected(on: boolean): void }
export function thumb(o: ThumbOpts): Thumb {
  const m = media(o.media);
  const row = h('span', { class: 's-thumb-row' }, h('span', { class: 's-thumb-title' }, o.title), o.mark ? h('span', { class: 's-thumb-mark' }, o.mark) : null);
  const el = h('button', { class: 's-thumb', type: 'button', 'aria-pressed': String(!!o.selected) }, m.el, row, o.sub ? h('span', { class: 's-thumb-sub' }, o.sub) : null);
  if (o.hoverPlay !== false) {
    el.addEventListener('pointerenter', () => m.play());
    el.addEventListener('pointerleave', () => { if (document.activeElement !== el) m.stop(); });
    el.addEventListener('focus', () => { m.play(); o.onFocus?.(); });
    el.addEventListener('blur', () => m.stop());
  }
  if (o.onClick) el.addEventListener('click', o.onClick);
  return { el, media: m, setSelected(on: boolean) { el.setAttribute('aria-pressed', String(on)); } };
}

// ── Keyboard hint ───────────────────────────────────────────────
export const kbd = (k: string): HTMLElement => h('kbd', { class: 's-kbd' }, k);
export function keyList(rows: [string[], string][]): HTMLDivElement {
  const el = h('div', { class: 's-keys' });
  for (const [keys, what] of rows) el.append(h('span', null, ...keys.map(kbd)), h('span', null, what));
  return el;
}

// ── Meter (segmented live level) ────────────────────────────────
export interface Meter { el: HTMLDivElement; set(level: number): void }
export function meter(segments = 18): Meter {
  const bars = Array.from({ length: segments }, () => h('i'));
  const el = h('div', { class: 's-meter', role: 'meter', 'aria-label': 'audio level', 'aria-valuemin': 0, 'aria-valuemax': 1 }, ...bars);
  let last = -1;
  return {
    el,
    set(level: number) {
      const n = Math.round(Math.max(0, Math.min(1, level)) * segments);
      if (n === last) return;
      last = n;
      bars.forEach((b, i) => b.classList.toggle('on', i < n));
    },
  };
}

// ── Toast ───────────────────────────────────────────────────────
let toastHost: HTMLDivElement | null = null;
export interface ToastOpts { action?: { label: string; onClick: () => void }; ms?: number }
export function toast(message: string, o: ToastOpts = {}): () => void {
  if (!toastHost) { toastHost = h('div', { class: 's-toasts s-root', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 's-toast' }, h('span', null, message));
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    t.classList.remove('is-in');
    window.setTimeout(() => t.remove(), 450);
  };
  if (o.action) t.append(button(o.action.label, { size: 'sm', onClick: () => { o.action?.onClick(); close(); } }));
  toastHost.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('is-in')));
  if (o.ms !== 0) window.setTimeout(close, o.ms ?? 3200);
  return close;
}

// ── Sheet / modal ───────────────────────────────────────────────
export interface Sheet { el: HTMLElement; body: HTMLElement; head: HTMLElement; open(): void; close(): void; isOpen(): boolean }
export function sheet(title: string, o: { kind?: 'sheet' | 'modal'; onClose?: () => void } = {}): Sheet {
  const kind = o.kind ?? 'sheet';
  const scrim = h('div', { class: 's-scrim s-root' });
  const closeBtn = button('', { variant: 'ghost', icon: 'close', title: 'Close' });
  const head = h('div', { class: 's-sheet-head' }, h('span', { class: 's-label s-bone' }, title), closeBtn);
  const body = h('div', { class: kind === 'sheet' ? 's-sheet-body' : '' });
  const el = h('div', { class: `${kind === 'sheet' ? 's-sheet' : 's-modal'} s-root`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, kind === 'sheet' ? head : null, body);
  let open = false;
  let lastFocus: Element | null = null;
  const close = (): void => {
    if (!open) return;
    open = false;
    el.classList.remove('is-open'); scrim.classList.remove('is-open');
    window.setTimeout(() => { if (!open) { el.remove(); scrim.remove(); } }, 450);
    if (lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
    o.onClose?.();
  };
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  return {
    el, body, head,
    open() {
      if (open) return;
      open = true;
      lastFocus = document.activeElement;
      document.body.append(scrim, el);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('is-open'); scrim.classList.add('is-open'); }));
      window.setTimeout(() => (el.querySelector<HTMLElement>('button, [tabindex], input, select') ?? el).focus({ preventScroll: true }), 60);
    },
    close,
    isOpen: () => open,
  };
}

// ── Info (i) control ────────────────────────────────────────────
export interface InfoContent {
  title: string;
  /** Scope chip, e.g. "for Ink" or "all styles". */
  scope?: string;
  body: string[];
  options?: [string, string][];
  media?: { src: MediaSrc; caption?: string }[];
}
let openPop: { pop: HTMLElement; btn: HTMLElement; medias: Media[] } | null = null;
function closePop(): void {
  if (!openPop) return;
  const { pop, btn, medias } = openPop;
  openPop = null;
  btn.setAttribute('aria-expanded', 'false');
  medias.forEach((m) => m.stop());
  pop.classList.remove('is-open');
  window.setTimeout(() => pop.remove(), 400);
}
document.addEventListener('pointerdown', (e) => {
  if (!openPop) return;
  const path = e.composedPath();
  if (path.includes(openPop.pop) || path.includes(openPop.btn)) return;
  closePop();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPop) { e.stopPropagation(); closePop(); } }, true);

export function infoButton(content: InfoContent | (() => InfoContent)): HTMLButtonElement {
  const btn = h('button', { class: 's-info', type: 'button', 'aria-label': 'What is this?', 'aria-expanded': 'false' }, 'i');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPop?.btn === btn) { closePop(); return; }
    closePop();
    const c = typeof content === 'function' ? content() : content;
    const medias: Media[] = [];
    const pop = h('div', { class: 's-pop s-root', role: 'dialog', 'aria-label': c.title });
    if (c.media?.length) {
      const grid = h('div', { class: 's-pop-media', style: { gridTemplateColumns: `repeat(${Math.min(c.media.length, 2)}, 1fr)` } });
      for (const m of c.media) {
        const md = media(m.src, { eager: true });
        medias.push(md);
        grid.append(h('figure', null, md.el, m.caption ? h('figcaption', null, m.caption) : null));
      }
      pop.append(grid);
    }
    const body = h('div', { class: 's-pop-body' },
      h('div', { class: 's-pop-head' }, h('span', { class: 's-label s-bone' }, c.title), c.scope ? h('span', { class: 's-chip' }, c.scope) : null),
      ...c.body.map((p) => h('p', null, p)));
    if (c.options?.length) {
      const dl = h('dl');
      for (const [t, d] of c.options) dl.append(h('dt', null, t), h('dd', null, d));
      body.append(dl);
    }
    pop.append(body);
    document.body.append(pop);
    // Place next to the button, kept on screen.
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left - pw - 12;
    if (left < 16) left = Math.min(window.innerWidth - pw - 16, r.right + 12);
    const top = Math.max(16, Math.min(window.innerHeight - ph - 16, r.top - 12));
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
    btn.setAttribute('aria-expanded', 'true');
    openPop = { pop, btn, medias };
    requestAnimationFrame(() => { pop.classList.add('is-open'); medias.forEach((m) => m.play()); });
  });
  return btn;
}
export const closeInfo = closePop;
