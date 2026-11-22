/**
 * Landing page: one live engine behind the page, handed from section to
 * section as you scroll. First paint is HTML, CSS, fonts and the poster; the
 * demo frames (≈150 KB) load after it and the engine after that, idle.
 *
 *   live   (desktop, WebGL 2): the fixed canvas renders while a live section
 *          is on screen; each section sets the scene; the hero poster fades
 *          into the engine once it has warmed up.
 *   static (phones, low power, no WebGL 2, reduced motion, ?static): each
 *          section shows its pre-rendered loop (still under reduced motion).
 */

import type { AudioFeatureFrame } from '../../../src/types/audio-frame';
import type { SonoraEvent } from '../../../src/engine/events';
import type { StyleId } from '../../../src/styles/visual-style';
import { PALETTES } from '../../../src/engine/color-engine';
import { describe } from '../../../src/app/catalog';
import { DemoPlayer } from '../lib/demo-player';
import { refreshDownloads } from '../lib/download';
import { siteMedia, HERO_SCENE, HERO_START_S, HERO_WARM_S, PALETTE_HOLD_S, PALETTE_SCENE, PREWARM_FIRST, PREWARM_LATER, PREWARM_TIMEOUT_MS, SCENES } from '../lib/scenes';
import type { Scene, Stage } from '../lib/stage';

// ── Tuning ──────────────────────────────────────────────────────
/** Hit levels that light a signal label, and how long it stays lit (s). */
const HIT_ON = { kick: 0.6, snare: 0.6, hats: 0.55 };
const HIT_HOLD_S = 0.12;
/** How long an event label stays lit after its event (s). */
const EVENT_HOLD_S = 1.4;
/** A live section counts as on screen when this much of the viewport shows it. */
const VISIBLE_FRACTION = 0.04;
/** Wait after load before fetching the engine (ms), so first paint stays light. */
const ENGINE_DELAY_MS = 400;
/** Earliest start of the shader warm-up, from navigation (ms). */
const PREWARM_NOT_BEFORE_MS = 2000;
/** No live section on screen for this long: compile Voyage then (ms). */
const LATER_PREWARM_IDLE_MS = 250;
const SOUND_URLS = { webm: '/demo/demo.webm', m4a: '/demo/demo.m4a' };

type SectionId = string;
interface LiveSection { el: HTMLElement; id: SectionId; scene: () => Scene | null }

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));
const isStatic = (): boolean => document.documentElement.classList.contains('static');
const reduced = (): boolean => document.documentElement.classList.contains('reduced');
const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const idle = (cb: () => void, ms = 0): void => {
  const go = (): void => { if ('requestIdleCallback' in window) requestIdleCallback(() => cb(), { timeout: 1500 }); else setTimeout(cb, 1); };
  setTimeout(go, ms);
};

/** Per-style chip choice (index into SCENES[style].options). */
const choice: Record<string, number> = Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, v.initial]));

export function boot(): void {
  void refreshDownloads();
  setupReveal();
  setupLightbox();
  setupChipsStatic();
  const sections = collectSections();
  setupNavClear();

  const start = (): void => {
    idle(() => { void startDemo(sections); }, 0);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

// ── Reveal on scroll ────────────────────────────────────────────
function setupReveal(): void {
  const els = $$('.rv');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

// ── Nav: clear over live sections, solid over the rest ──────────
function setupNavClear(): void {
  const live = $$('section.live');
  const check = (): void => {
    const y = 40;
    const over = live.some((s) => { const r = s.getBoundingClientRect(); return r.top <= y && r.bottom > y; });
    document.documentElement.classList.toggle('nav-clear', over);
    document.documentElement.classList.toggle('at-hero', window.scrollY < window.innerHeight * 0.45);
    $('[data-nav]')?.classList.toggle('is-solid', !over && window.scrollY > 24);
  };
  window.addEventListener('scroll', () => requestAnimationFrame(check), { passive: true });
  check();
}

// ── Trailer lightbox ────────────────────────────────────────────
function setupLightbox(): void {
  const lb = $('#lb');
  const video = $<HTMLVideoElement>('#lb-video');
  if (!lb || !video) return;
  let opener: HTMLElement | null = null;
  const close = (): void => { lb.classList.remove('is-open'); video.pause(); opener?.focus(); };
  $$('[data-trailer]').forEach((b) => b.addEventListener('click', () => {
    opener = b;
    lb.classList.add('is-open');
    $<HTMLButtonElement>('[data-lb-close]', lb)?.focus();
    // Sound off by default: the trailer follows the page's sound toggle (its own controls can unmute).
    video.muted = !$$('[data-sound]').some((s) => s.getAttribute('aria-pressed') === 'true');
    void video.play().catch(() => undefined);
  }));
  $('[data-lb-close]', lb)?.addEventListener('click', close);
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('is-open')) close(); });
}

// ── Static mode: chips swap the section's loop ──────────────────
function setupChipsStatic(): void {
  for (const sec of $$('section[data-style]')) {
    const style = sec.dataset.style!;
    $$<HTMLButtonElement>('[data-chip]', sec).forEach((chip) => chip.addEventListener('click', () => {
      const j = Number(chip.dataset.chip);
      choice[style] = j;
      $$('[data-chip]', sec).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      if (isStatic() || sec.classList.contains('use-loop')) swapFallback(sec, chip.dataset.media!);
      else applyScene();
    }));
  }
}

function swapFallback(sec: HTMLElement, media: string): void {
  const m = siteMedia(media);
  const img = $<HTMLImageElement>('[data-fb-img]', sec);
  const video = $<HTMLVideoElement>('[data-fb-video]', sec);
  if (img && m.still) { img.removeAttribute('srcset'); img.src = m.still; }
  if (video) {
    video.poster = m.still;
    video.dataset.src = m.loop ?? '';
    if (video.src) { video.src = m.loop ?? ''; if (m.loop && !reduced()) void video.play().catch(() => undefined); }
  }
}

function startFallbackVideos(): void {
  if (reduced()) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) {
        if (!v.src && v.dataset.src) v.src = v.dataset.src;
        void v.play().catch(() => undefined);
      } else v.pause();
    }
  }, { threshold: 0.15 });
  $$<HTMLVideoElement>('[data-fb-video]').forEach((v) => io.observe(v));
}

// ── Sections ────────────────────────────────────────────────────
let stage: Stage | null = null;
let currentSection: SectionId | null = null;

function collectSections(): LiveSection[] {
  return $$('section.live').map((el) => {
    const id = el.dataset.scene!;
    const style = el.dataset.style as StyleId | undefined;
    const scene = (): Scene | null => {
      if (id === 'hero' || id === 'hears') return HERO_SCENE;
      if (style) { const sc = SCENES[style as keyof typeof SCENES]; return sc.options[choice[style]].scene; }
      if (id === 'palettes') return PALETTE_SCENE;
      return null; // Set Mode chooses for itself
    };
    return { el, id, scene };
  });
}

/** The live section at the viewport's centre, and whether any live section shows. */
function measure(sections: LiveSection[]): { active: LiveSection | null; visible: boolean } {
  const vh = window.innerHeight;
  let active: LiveSection | null = null;
  let visible = false;
  for (const s of sections) {
    const r = s.el.getBoundingClientRect();
    const shown = Math.min(vh, r.bottom) - Math.max(0, r.top);
    if (shown > vh * VISIBLE_FRACTION) visible = true;
    if (r.top <= vh / 2 && r.bottom > vh / 2) active = s;
  }
  return { active, visible };
}

let applyScene: () => void = () => undefined;

// ── Demo + engine ───────────────────────────────────────────────
async function startDemo(sections: LiveSection[]): Promise<void> {
  const start = (p: DemoPlayer): DemoPlayer => { p.seek(HERO_START_S); setupBoard(p); return p; };
  if (isStatic()) {
    // No engine: the frames only drive the signals board (and the sound), so
    // they load when that section comes near or sound is asked for.
    startFallbackVideos();
    let loading: Promise<DemoPlayer | null> | null = null;
    const ensure = (): Promise<DemoPlayer | null> => (loading ??= DemoPlayer.load('/demo/frames.bin').then((p) => {
      start(p);
      const tick = (): void => { p.tick(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return p;
    }).catch(() => null));
    const hears = $('section[data-scene="hears"]');
    if (hears && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); void ensure(); } }, { rootMargin: '60% 0px' });
      io.observe(hears);
    }
    setupSound(ensure);
    return;
  }
  let player: DemoPlayer;
  try {
    player = start(await DemoPlayer.load('/demo/frames.bin'));
  } catch {
    document.documentElement.classList.add('static');
    startFallbackVideos();
    return;
  }
  setupSound(() => Promise.resolve(player));
  // Start compiling once the page has settled (fonts in, first frames painted):
  // while the GPU process compiles, any repaint waits for it.
  // Also not before the browser has torn down the previous page's compositor
  // (about a second after navigating), which otherwise waits on the busy GPU.
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, Math.max(ENGINE_DELAY_MS, PREWARM_NOT_BEFORE_MS - performance.now())));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Until the engine is ready every live section shows its still.
  document.documentElement.classList.add('warming');
  const goStatic = (err?: unknown): void => {
    if (err) console.warn('sonora: live engine unavailable, showing loops', err);
    document.documentElement.classList.remove('warming');
    document.documentElement.classList.add('static');
    startFallbackVideos();
    const tick = (): void => { player.tick(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  let mod: typeof import('../lib/stage');
  try {
    mod = await import('../lib/stage');
    // The page shows every art style: their code loads in parallel before the stage exists.
    await mod.preloadStyles(['ink', 'silk', 'wisp', 'warp', 'voyage']);
    // Compile every style in a worker first (nothing live on screen yet, so
    // the GPU process can be busy); then each section switch takes milliseconds.
    const t0 = performance.now();
    const log: string[] = [];
    const ok = await mod.prewarm(PREWARM_FIRST, innerWidth * Math.min(devicePixelRatio || 1, 1.5), innerHeight * Math.min(devicePixelRatio || 1, 1.5), PREWARM_TIMEOUT_MS,
      (sc, ms) => log.push(`${sc.style}:${sc.variant}:${sc.depth ? 'depth' : 'flat'} ${ms.toFixed(0)} ms`));
    (window as unknown as { __prewarm?: unknown }).__prewarm = { ok, ms: performance.now() - t0, log };
    const canvas = $<HTMLCanvasElement>('#stage')!;
    stage = mod.createStage(canvas, player, 'medium');
  } catch (err) {
    goStatic(err);
    return;
  }
  const st = stage;
  (window as unknown as { __stage?: Stage; __player?: DemoPlayer }).__stage = st;
  (window as unknown as { __player?: DemoPlayer }).__player = player;

  // Voyage on a slow GPU: its loop instead (measured frame time).
  const slowStyles = new Set<StyleId>();
  st.onSlow((style) => {
    if (style !== 'voyage') return;
    slowStyles.add(style);
    const sec = $('section[data-style="voyage"]');
    if (sec) { sec.classList.add('use-loop'); startSectionVideo(sec); }
    applyScene();
  });

  setupPalettes(st);
  setupSetMode(st, player);

  // Hero: warm the fluid up behind the poster, then fade the engine in.
  st.show(HERO_SCENE, true);
  await st.warm(HERO_START_S, HERO_WARM_S);
  // ?poster: hand the warmed-up frame to scripts/poster.mjs (the hero poster is this exact frame).
  if (/[?&]poster/.test(location.search)) {
    st.renderer.step(1 / 30);
    (window as unknown as { __poster?: string }).__poster = st.renderer.canvas.toDataURL('image/png');
    return;
  }
  // Voyage compiles later, while nothing live is on screen (or while its own
  // section shows the loop). Until then its section plays the loop.
  let voyageState: 'cold' | 'warming' | 'ready' = 'cold';
  // Set Mode leaves Voyage out until it has compiled (no multi-second main-thread build).
  const fullInclude = [...st.ctl.settings.setMode.include];
  st.ctl.settings.setMode.include = fullInclude.filter((id) => !id.startsWith('voyage'));
  let hiddenSince = 0;
  const warmVoyage = (): void => {
    if (voyageState !== 'cold') return;
    voyageState = 'warming';
    st.setActive(false);
    void mod.prewarm(PREWARM_LATER, innerWidth, innerHeight, PREWARM_TIMEOUT_MS).then(() => {
      voyageState = 'ready';
      st.ctl.settings.setMode.include = fullInclude;
      const sec = $('section[data-style="voyage"]');
      sec?.classList.remove('use-loop');
      applyScene();
    });
  };
  let lastVisible = false;
  applyScene = (): void => {
    const { active, visible } = measure(sections);
    const onVoyage = active?.el.dataset.style === 'voyage';
    if (onVoyage && voyageState !== 'ready') {
      const sec = active!.el;
      sec.classList.add('use-loop');
      startSectionVideo(sec);
      warmVoyage();
    }
    if (!visible && voyageState === 'cold') {
      hiddenSince ||= performance.now();
      if (performance.now() - hiddenSince > LATER_PREWARM_IDLE_MS) warmVoyage();
      else window.setTimeout(() => applyScene(), LATER_PREWARM_IDLE_MS + 20);
    } else hiddenSince = 0;
    const voyageLoop = onVoyage && (slowStyles.has('voyage') || voyageState !== 'ready');
    st.setActive(visible && !voyageLoop && voyageState !== 'warming');
    if (visible !== lastVisible) {
      lastVisible = visible;
      $('#stage')!.classList.toggle('is-on', visible);
    }
    if (!active) return;
    const changed = active.id !== currentSection;
    const prev = currentSection;
    currentSection = active.id;
    if (changed) onLeave(prev, st);
    const scene = active.scene();
    if (scene && !voyageLoop) st.show(scene);
    if (changed) onEnter(active.id, st);
    checkLight();
  };
  // Paper looks (Sumi) get a solid nav so its links stay readable.
  let lightTimer = 0;
  const checkLight = (): void => {
    const set = (): void => { document.documentElement.classList.toggle('light-scene', lastVisible && st.renderer.isLight()); };
    set();
    window.clearTimeout(lightTimer);
    lightTimer = window.setTimeout(set, 700);
  };
  st.ctl.subscribe(() => checkLight());
  st.onReady(() => {
    $('#poster')?.classList.add('is-off');
    const html = document.documentElement;
    html.classList.add('unwarming');
    html.classList.remove('warming');
    window.setTimeout(() => html.classList.remove('unwarming'), 800);
  });
  applyScene();
  $('#stage')!.classList.add('is-on');
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; applyScene(); });
  }, { passive: true });
  window.addEventListener('resize', () => applyScene());

  // Hero tag follows what is on screen.
  const tag = $('#hero-tag');
  st.ctl.subscribe(() => {
    if (tag) tag.textContent = `live engine · ${describe(st.ctl.settings.mode, st.ctl.variantFor(st.ctl.settings.mode), st.ctl.depthFor(st.ctl.settings.mode), !!st.renderer.getDescriptor().supportsDepth)}`;
  });
}

function startSectionVideo(sec: HTMLElement): void {
  const v = $<HTMLVideoElement>('[data-fb-video]', sec);
  if (!v || reduced()) return;
  if (!v.src && v.dataset.src) v.src = v.dataset.src;
  void v.play().catch(() => undefined);
}

// Section hooks (palettes cycle, Set Mode autopilot).
const enterHooks: Record<string, (st: Stage) => void> = {};
const leaveHooks: Record<string, (st: Stage) => void> = {};
function onEnter(id: SectionId, st: Stage): void { enterHooks[id]?.(st); }
function onLeave(id: SectionId | null, st: Stage): void { if (id) leaveHooks[id]?.(st); }

// ── Palettes ────────────────────────────────────────────────────
function setupPalettes(st: Stage): void {
  const buttons = $$<HTMLButtonElement>('[data-pal]');
  const hues = $$<HTMLButtonElement>('[data-hue]');
  const drift = $<HTMLButtonElement>('[data-drift]');
  const name = $('#pal-name');
  const auto = $('#pal-auto');
  let cycling = true;
  let timer = 0;
  let idx = 0;
  const mark = (i: number | null, hue: number | null): void => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.pal) === i)));
    hues.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.hue) === hue)));
    if (name) name.textContent = i !== null ? `${i + 1} · ${PALETTES[i].name}` : hue !== null ? `custom · ${hue}°` : '';
  };
  const setAuto = (on: boolean): void => {
    cycling = on;
    window.clearInterval(timer);
    if (auto) auto.textContent = on ? 'cycling · tap one to hold it' : st.ctl.settings.autoDrift ? 'auto drift · turning slowly' : 'held · scroll on, or tap another';
    if (on) timer = window.setInterval(() => { idx = (idx + 1) % PALETTES.length; st.ctl.setPalette(idx); mark(idx, null); }, PALETTE_HOLD_S * 1000);
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    idx = Number(b.dataset.pal);
    st.ctl.setPalette(idx);
    mark(idx, null);
    setAuto(false);
  }));
  hues.forEach((b) => b.addEventListener('click', () => {
    const h = Number(b.dataset.hue);
    st.ctl.setCustomHue(h);
    mark(null, h);
    setAuto(false);
  }));
  drift?.addEventListener('click', () => {
    const on = !st.ctl.settings.autoDrift;
    st.ctl.setDriftPeriod(60);
    st.ctl.setAutoDrift(on);
    drift.setAttribute('aria-pressed', String(on));
    setAuto(false);
  });
  let touched = false;
  [...buttons, ...hues].forEach((b) => b.addEventListener('click', () => { touched = true; }));
  drift?.addEventListener('click', () => { touched = true; });
  enterHooks.palettes = () => { if (!touched) setAuto(true); };
  leaveHooks.palettes = () => {
    window.clearInterval(timer);
    // An untouched cycle leaves the page in the default palette.
    if (!touched) { idx = 0; st.ctl.setPalette(0); mark(0, null); }
    cycling = false;
    void cycling;
  };
}

// ── Set Mode ────────────────────────────────────────────────────
function setupSetMode(st: Stage, player: DemoPlayer): void {
  const now = $('#sm-now');
  const rows = $('#sm-rows');
  let lastEvent = 'set mode on';
  st.renderer.onEvent((e) => { if (e.type === 'drop' || e.type === 'trackChange' || e.type === 'breakdown') lastEvent = e.type === 'trackChange' ? 'track change' : e.type; });
  const log = (why: string): void => {
    const m = st.ctl.settings.mode;
    const what = describe(m, st.ctl.variantFor(m), st.ctl.depthFor(m), !!st.renderer.getDescriptor().supportsDepth);
    if (now) now.textContent = what;
    if (!rows) return;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span>${fmt(player.time)}</span><span><b></b> → <i></i></span>`;
    row.querySelector('b')!.textContent = why;
    const i = row.querySelector('i')!;
    i.style.fontStyle = 'normal';
    i.textContent = what;
    if (rows.firstElementChild?.textContent?.startsWith('—')) rows.innerHTML = '';
    rows.prepend(row);
    while (rows.children.length > 4) rows.lastElementChild?.remove();
  };
  let last = '';
  st.ctl.subscribe((s) => {
    if (currentSection !== 'setmode') return;
    const key = `${s.mode}:${st.ctl.variantFor(s.mode)}:${st.ctl.depthFor(s.mode)}`;
    if (key !== last) { last = key; log(lastEvent); }
  });
  enterHooks.setmode = () => {
    lastEvent = 'set mode on';
    st.setMode.setOn(true);
    st.setMode.switchNow(false);
  };
  leaveHooks.setmode = () => { st.setMode.setOn(false); };
  $('[data-skip-drop]')?.addEventListener('click', () => {
    const t = player.nextEvent('drop', player.time);
    if (t !== null) player.seek(Math.max(0, t - 3.5));
  });
}

// ── Signals board ───────────────────────────────────────────────
function setupBoard(player: DemoPlayer): void {
  const cells = new Map($$('[data-sig]').map((el) => [el.dataset.sig!, { el, bar: $('i', el)!, until: 0 }]));
  const bpm = $('#bd-bpm'), section = $('#bd-section'), intensity = $('#bd-int'), clock = $('#bd-clock'), head = $('#bd-head');
  const timeline = head?.parentElement ?? null;
  let wall = 0;
  const lit = (id: string, v: number, on: boolean): void => {
    const c = cells.get(id);
    if (!c) return;
    c.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
    if (on) c.until = wall + HIT_HOLD_S;
    c.el.classList.toggle('on', wall < c.until);
  };
  let lastUi = 0;
  player.onFrame((f: AudioFeatureFrame, t: number) => {
    wall = performance.now() / 1000;
    const kick = Math.max(f.hits.sub_bass, f.hits.bass);
    const snare = Math.max(f.hits.mid, f.hits.upper_mid);
    const hats = Math.max(f.hits.high, f.hits.air);
    lit('kick', kick, kick > HIT_ON.kick);
    lit('snare', snare, snare > HIT_ON.snare);
    lit('hats', hats, hats > HIT_ON.hats);
    const c = cells.get('bass');
    if (c) { c.bar.style.transform = `scaleX(${f.presence.bass.toFixed(3)})`; c.el.classList.toggle('on', f.presence.bass > 0.75 && kick > 0.2); }
    const sec = player.events.state.section;
    const b = cells.get('build');
    if (b) { b.bar.style.transform = `scaleX(${player.events.state.buildProgress.toFixed(3)})`; if (sec === 'build') b.until = Math.max(b.until, wall + 0.2); }
    for (const id of ['build', 'drop', 'breakdown', 'bigHit', 'trackChange']) {
      const cc = cells.get(id)!;
      cc.el.classList.toggle('on', wall < cc.until);
    }
    const d = cells.get('drop');
    if (d) d.bar.style.transform = `scaleX(${player.events.state.dropEnvelope.toFixed(3)})`;
    if (wall - lastUi > 0.1) {
      lastUi = wall;
      if (bpm) bpm.textContent = f.beat.confidence > 0.3 ? `${Math.round(f.beat.bpm)} bpm` : '— bpm';
      if (section) section.textContent = sec;
      if (intensity) intensity.textContent = f.intensity.toFixed(2);
      if (clock) clock.textContent = `${fmt(t)} / ${fmt(player.duration)}`;
      if (head && timeline) head.style.transform = `translateX(${(t / player.duration) * timeline.clientWidth}px)`;
    }
  });
  player.onEvent((e: SonoraEvent) => {
    const c = cells.get(e.type);
    if (c) c.until = performance.now() / 1000 + EVENT_HOLD_S;
  });
}

// ── Sound ───────────────────────────────────────────────────────
function setupSound(get: () => Promise<DemoPlayer | null>): void {
  const btns = $$<HTMLButtonElement>('[data-sound]');
  const label = (t: string): void => btns.forEach((b) => { const l = $('[data-sound-label]', b); if (l) l.textContent = t; });
  btns.forEach((btn) => btn.addEventListener('click', async () => {
    label('Loading…');
    const player = await get();
    if (!player) { label('Sound off'); return; }
    const on = !player.sound;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(on)));
    try {
      await player.setSound(on, SOUND_URLS);
    } catch {
      btns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    }
    label(player.sound ? 'Sound on' : 'Sound off');
  }));
}
