/**
 * Settings, rebuilt for people who have never used a visualizer. Every control
 * has a plain label, its current value and an (i) card that explains what it
 * does, when to change it and what each option means (with a picture or loop
 * where words aren't enough). Per-style settings say which style they're for;
 * quality and frame rate are global.
 */

import { mediaFor, PIECES, SHORTCUTS, STYLE_INFO } from '../../app/catalog';
import type { Controller } from '../../app/controller';
import type { Platform } from '../../app/platform';
import { audioStatus } from '../../app/stores';
import { FLAT_ZOOM_MAX, FLAT_ZOOM_MIN } from '../../engine/camera';
import { MAX_DRIFT_PERIOD_S, MIN_DRIFT_PERIOD_S, PALETTES } from '../../engine/color-engine';
import type { QualityPreset } from '../../engine/quality';
import { FPS_CAPS, SET_MODE_INTERVALS, type Corner } from '../../ipc/settings';
import { getStyle, presetsFor } from '../../styles/registry';
import { variantSupportsLight, type LightMode } from '../../styles/visual-style';
import {
  button, infoButton, keyList, meter, segmented, select, sheet, slider, thumb, toggle, type InfoContent,
} from '../ds/components';
import { h } from '../ds/dom';
import { lockup } from './brand';

const PRESET_MATCH = 0.03;
export const SECTIONS = ['visual', 'colour', 'camera', 'feel', 'set mode', 'now playing', 'audio', 'performance', 'system', 'keys', 'about'] as const;
export type SectionId = typeof SECTIONS[number];

export interface SettingsHandlers {
  replayIntro(): void;
  setSetMode(on: boolean): void;
}

export interface SettingsSheet { open(section?: string): void; close(): void; isOpen(): boolean }

// ── Copy for the (i) cards ──────────────────────────────────────
const INFO = {
  style: (): InfoContent => ({
    title: 'style', scope: 'the visual',
    body: ['The kind of visual on screen. Each style has its own personality and keeps its own settings (colours, feel, camera).'],
    options: (['ink', 'silk', 'wisp', 'warp', 'voyage'] as const).map((s) => [STYLE_INFO[s].label, STYLE_INFO[s].line]),
  }),
  look: (style: string): InfoContent => ({
    title: 'look', scope: `for ${style}`,
    body: ['A variation of the style: same movement, different material.'],
    options: STYLE_INFO[style as keyof typeof STYLE_INFO]?.looks.map((l) => [l.label, l.line + (l.depthOnly ? ' (Depth view)' : '')]) ?? [],
  }),
  view: (style: string): InfoContent => ({
    title: 'view', scope: `for ${style}`,
    body: ['How you look at the visual. Depth puts a 3D camera over it that glides, banks on beats and lurches on drops. Flat looks straight at it like a canvas.',
      'Change it to taste; Flat is a little lighter on the graphics card.'],
    media: [{ src: mediaFor(`${style}-view-depth`), caption: 'depth' }, { src: mediaFor(`${style}-view-flat`), caption: 'flat' }],
  }),
  light: (): InfoContent => ({
    title: 'background', scope: 'this look',
    body: ['Dark or paper-light background for looks that support both.'],
    options: [['Auto', 'The look’s natural background (Sumi is paper, the rest are dark).'], ['Dark', 'Always dark.'], ['Light', 'Always light, like ink on paper.']],
    media: [{ src: mediaFor('explain-light-dark'), caption: 'dark' }, { src: mediaFor('explain-light-light'), caption: 'light' }],
  }),
  classic: (): InfoContent => ({ title: 'classic styles', body: ['Adds Aura and Halo, the original visuals from sonora 0.1, to the menu.'] }),
  palette: (style: string, match: boolean): InfoContent => ({
    title: 'palette', scope: match ? 'all styles' : `for ${style}`,
    body: ['The set of colours the visual paints with. Split swatches are two-tone palettes: one colour and black.',
      'Number keys 1–9 switch palettes while the visual plays. Custom builds a palette around any colour you pick.'],
  }),
  drift: (style: string, match: boolean): InfoContent => ({
    title: 'colour drift', scope: match ? 'all styles' : `for ${style}`,
    body: ['Slowly turns every colour of the palette around the colour wheel, so a long session never stays one colour.',
      'Off keeps the palette exactly as it is. Drift speed sets how long one full turn takes.'],
  }),
  match: (): InfoContent => ({
    title: 'same colours for every style',
    body: ['Normally each style remembers its own palette and drift, so Ink can be blue while Warp is gold.',
      'Turn this on to use one set of colours everywhere. Other settings (feel, camera) stay per style.'],
  }),
  camera: (style: string): InfoContent => ({
    title: 'camera', scope: `for ${style}`,
    body: ['In the Depth view a camera flies over the visual. Presets are good starting points; height, tilt and curve fine-tune it.',
      'You can also drag on the picture to look around, scroll to change height, and double-click to snap back to the nearest preset.'],
    options: presetsFor('ink').map((p) => [p.label, p.hint]),
    media: ['glide', 'planet', 'valley', 'overhead'].map((c) => ({ src: mediaFor(`explain-cam-${c}`), caption: c })),
  }),
  height: (): InfoContent => ({ title: 'height, tilt, curve', body: ['Height: how far above the surface the camera flies.', 'Tilt: from looking toward the horizon to looking straight down.', 'Curve: bend the surface down like a planet (∩) or up around you like a bowl (U). The middle is flat.'] }),
  zoom: (style: string): InfoContent => ({ title: 'zoom', scope: `for ${style}`, body: ['How close the Flat view sits. The middle of the slider is the default; double-click it to snap back. Scroll on the picture to zoom too.'] }),
  resp: (style: string): InfoContent => ({
    title: 'responsiveness', scope: `for ${style}`,
    body: ['How hard the visual moves on each beat. Smooth flows and glides; Punchy snaps and jumps on every hit.',
      'Only the motion changes: brightness stays steady either way, so Punchy never strobes.'],
    media: [{ src: mediaFor('explain-resp-smooth'), caption: 'smooth' }, { src: mediaFor('explain-resp-punchy'), caption: 'punchy' }],
  }),
  rings: (): InfoContent => ({ title: 'rings', scope: 'for aura', body: ['How many concentric shapes Aura draws.'] }),
  setmode: (): InfoContent => ({
    title: 'set mode',
    body: ['Lets sonora choose, like a VJ: it switches style, look and view when the track changes, and sometimes on a big drop after a long build.',
      'It picks to suit the music: calm, beatless music leans to Ink, Wisp and Voyage; driving four-on-the-floor leans to Silk, Warp and Voyage dives. It never repeats itself straight away.'],
    options: [['M', 'Turn it on or off from anywhere.']],
  }),
  include: (): InfoContent => ({ title: 'what it can choose', body: ['Untick anything you never want Set Mode to pick. With nothing ticked it uses everything.'] }),
  interval: (): InfoContent => ({ title: 'at most every', body: ['The shortest time between switches. Track changes and drops can only switch once this much time has passed.'] }),
  setpal: (): InfoContent => ({ title: 'change palettes', body: ['Also pick a fresh palette at each switch. Off keeps each style’s own colours.'] }),
  np: (): InfoContent => ({
    title: 'now playing',
    body: ['Shows the song your music app reports to Windows (Spotify, browsers, most players): title, artist and cover. It appears for a few seconds when the track changes or the mouse moves, then fades.',
      'Track changes also tell the visuals a new song has started.'],
  }),
  npControls: (): InfoContent => ({ title: 'controls', body: ['Previous, play/pause and next buttons under the song, sent to the app that’s playing.'] }),
  device: (platform: string): InfoContent => platform === 'web'
    ? { title: 'audio source', body: ['In the browser, sonora needs a source: share a tab that plays music (best), your whole computer, the microphone, or play a file.'] }
    : {
      title: 'listen to',
      body: ['sonora listens to what your PC plays through an output (speakers, headphones, a headset). It doesn’t record anything and nothing leaves your computer.',
        'Recommended: follow Windows. It switches by itself when you plug something in. Pick a device only if your music plays somewhere else.'],
    },
  quality: (): InfoContent => ({
    title: 'quality', scope: 'all styles',
    body: ['How much detail the graphics card draws. Higher is sharper but works the card harder (and laptops warmer).'],
    options: [['Low', 'Smaller render size and simulations. Laptops and built-in graphics.'], ['Medium', 'Balanced. Smooth on most graphics cards.'], ['High', 'Full resolution and the finest detail.'], ['Auto', 'Starts at Medium and steps up or down to stay smooth.']],
    media: [{ src: mediaFor('explain-quality-low'), caption: 'low' }, { src: mediaFor('explain-quality-high'), caption: 'high' }],
  }),
  fps: (): InfoContent => ({
    title: 'frame rate', scope: 'all styles',
    body: ['How many pictures per second sonora draws. 60 is smooth on any screen. Raise it on high-refresh displays if your graphics card keeps up; 30 eases the load on slower computers.', 'Max matches your display.'],
  }),
  openLast: (): InfoContent => ({ title: 'open straight into my last visual', body: ['Skip the home menu on launch and start where you left off. Esc still brings the menu back.'] }),
  monitor: (): InfoContent => ({ title: 'fullscreen display', body: ['Which screen fullscreen uses. “Current” uses whichever screen the window is on.'] }),
  updates: (): InfoContent => ({ title: 'updates', body: ['Checks GitHub for a new version when sonora starts. If there is one, a small notice offers to install it. Nothing else is sent.'] }),
};

export function createSettings(ctl: Controller, platform: Platform, on: SettingsHandlers): SettingsSheet {
  const s = ctl.settings;
  const sh = sheet('settings', { onClose: () => { unsubs.forEach((u) => u()); unsubs = []; } });
  const nav = h('nav', { class: 'st-nav' });
  const content = h('div');
  sh.body.append(content);
  sh.body.before(nav);
  let unsubs: (() => void)[] = [];
  let devices: { value: string; label: string }[] = [];
  let monitors: { value: string; label: string }[] = [];

  const sections: Record<string, HTMLElement> = {};
  nav.append(...SECTIONS.map((id) => {
    const b = h('button', { type: 'button' }, id);
    b.addEventListener('click', () => sections[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return b;
  }));
  sh.body.addEventListener('scroll', () => {
    const top = sh.body.getBoundingClientRect().top + 8;
    let cur = SECTIONS[0] as string;
    for (const id of SECTIONS) if (sections[id] && sections[id].getBoundingClientRect().top <= top) cur = id;
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b.textContent === cur)));
  });

  const row = (label: string, info: InfoContent | (() => InfoContent), value: string | Node | null, control?: Node | null, inline = false): HTMLElement => {
    const head = h('div', { class: 'st-row-head' },
      h('div', { class: 'lbl' }, h('span', null, label), infoButton(info)),
      inline ? null : (value === null ? null : (typeof value === 'string' ? h('span', { class: 'val' }, value) : value)));
    if (inline) return h('div', { class: 'st-row inline' }, head, control ?? null);
    return h('div', { class: 'st-row' }, head, control ?? null);
  };
  const section = (id: SectionId, title: string, scope: string | null, ...rows: (Node | null)[]): HTMLElement => {
    const el = h('section', { class: 'st-sec' }, h('div', { class: 'st-sec-head' }, h('h2', { class: 's-h2' }, title), scope ? h('span', { class: 's-chip' }, scope) : null), ...rows);
    sections[id] = el;
    return el;
  };

  function build(): void {
    const id = s.mode;
    const d = getStyle(id);
    const info = STYLE_INFO[id];
    const name = info.label.toLowerCase();
    const look = ctl.variantFor(id);
    const depth = ctl.depthFor(id);
    const depthOn = d.supportsDepth && depth;
    const forStyle = `for ${name}`;
    const colourScope = s.matchColours ? 'all styles' : forStyle;

    // Visual
    const visual = section('visual', 'visual', forStyle,
      info.looks.length && (id !== 'wisp' || depthOn) ? row('Look', INFO.look(id), info.looks.find((l) => l.id === look)?.label ?? '',
        segmented(info.looks.map((l) => ({ value: l.id, label: l.label })), look, (v) => ctl.setVariant(v), 'Look').el) : null,
      d.supportsDepth ? row('View', INFO.view(id), depth ? 'Depth' : 'Flat',
        segmented([{ value: 'depth', label: 'Depth' }, { value: 'flat', label: 'Flat' }], depth ? 'depth' : 'flat', (v) => ctl.setDepth(v === 'depth'), 'View').el) : null,
      variantSupportsLight(d, look) ? row('Background', INFO.light(), s.lightModes[id] ?? 'auto',
        segmented((['auto', 'dark', 'light'] as LightMode[]).map((m) => ({ value: m, label: m })), s.lightModes[id] ?? 'auto', (v) => ctl.setLightMode(v), 'Background').el) : null,
      id === 'aura' ? row('Rings', INFO.rings(), String(s.ringCount), slider({ min: 2, max: 10, value: s.ringCount, onInput: (v) => ctl.setRingCount(v) }).el) : null,
      row('Show classic styles', INFO.classic(), null, toggle('', s.showClassic, (v) => ctl.setShowClassic(v)).el, true));
    if (!visual.querySelector('.st-row:not(.inline)')) visual.insertBefore(h('p', { class: 'st-note', style: { marginTop: '0', marginBottom: '14px' } }, `${info.label} has one look and one view.`), visual.children[1]);

    // Colour: swatches applied to a thumbnail of this style.
    const pals = h('div', { class: 'st-pals' });
    PALETTES.forEach((p, i) => {
      const t = thumb({ media: mediaFor(`pal-${id}-${i}`, `pal-ink-${i}`), title: p.name.replace(' / Black', ' duo'), selected: s.paletteIndex === i, hoverPlay: false, onClick: () => ctl.setPalette(i) });
      t.el.classList.add('pal-thumb');
      t.media.el.append(h('i', { class: 'pal-chip', style: { background: p.duotone ? `linear-gradient(135deg, ${p.preview} 50%, #08080A 50%)` : p.preview } }));
      pals.append(t.el);
    });
    const custom = h('button', { class: 's-thumb', type: 'button', 'aria-pressed': String(s.paletteIndex < 0) },
      h('div', { class: 's-media', style: { background: `hsl(${s.customHue} 60% 42%)` } }), h('span', { class: 's-thumb-row' }, h('span', { class: 's-thumb-title' }, 'Custom')));
    custom.addEventListener('click', () => ctl.setCustomHue(s.customHue));
    pals.append(custom);
    const palName = s.paletteIndex >= 0 ? PALETTES[s.paletteIndex]?.name ?? '' : 'Custom';
    const colour = section('colour', 'colour', colourScope,
      row('Palette', INFO.palette(name, s.matchColours), palName, pals),
      s.paletteIndex < 0 ? row('Custom colour', { title: 'custom colour', body: ['Pick any colour; sonora builds a matching palette around it.'] }, `${s.customHue}°`,
        slider({ min: 0, max: 360, value: s.customHue, hue: true, onInput: (v) => ctl.setCustomHue(v) }).el) : null,
      row('Colour drift', INFO.drift(name, s.matchColours), null, toggle('', s.autoDrift, (v) => ctl.setAutoDrift(v)).el, true),
      s.autoDrift ? row('Drift speed', INFO.drift(name, s.matchColours), cycle(s.driftPeriod),
        slider({ min: MIN_DRIFT_PERIOD_S, max: MAX_DRIFT_PERIOD_S, step: 10, value: MAX_DRIFT_PERIOD_S + MIN_DRIFT_PERIOD_S - s.driftPeriod, ends: ['slow', 'fast'], onInput: (v) => ctl.setDriftPeriod(MAX_DRIFT_PERIOD_S + MIN_DRIFT_PERIOD_S - v) }).el) : null,
      row('Same colours for every style', INFO.match(), null, toggle('', s.matchColours, (v) => ctl.setMatchColours(v)).el, true));

    // Camera
    const presets = presetsFor(id);
    const active = presets.find((p) => Math.abs(p.view.height - s.camera.height) < PRESET_MATCH && Math.abs(p.view.tilt - s.camera.tilt) < PRESET_MATCH && Math.abs(p.view.curve - s.camera.curve) < PRESET_MATCH);
    const ownCamera = id === 'wisp' && depthOn && look === 'tunnel';
    const zoomToSlider = (z: number): number => (z <= 1 ? 50 * (z - FLAT_ZOOM_MIN) / (1 - FLAT_ZOOM_MIN) : 50 + 50 * (z - 1) / (FLAT_ZOOM_MAX - 1));
    const sliderToZoom = (n: number): number => (n <= 50 ? FLAT_ZOOM_MIN + (1 - FLAT_ZOOM_MIN) * (n / 50) : 1 + (FLAT_ZOOM_MAX - 1) * ((n - 50) / 50));
    const camera = section('camera', 'camera', forStyle,
      ...(ownCamera ? [h('p', { class: 'st-note', style: { marginTop: '0' } }, 'The tunnel has its own camera that rides behind the flames. Switch the look to Ground for camera presets.')]
        : depthOn ? [
          row('Preset', INFO.camera(name), active?.label ?? 'custom',
            segmented(presets.map((p) => ({ value: p.id, label: p.label, title: p.hint })), active?.id ?? ('' as string), (v) => { const p = presets.find((x) => x.id === v); if (p) ctl.setCamera({ ...p.view }); }, 'Camera preset').el),
          row('Height', INFO.height(), `${Math.round(s.camera.height * 100)}`, slider({ min: 0, max: 100, value: Math.round(s.camera.height * 100), ends: ['skim the surface', 'high above'], onInput: (v) => ctl.setCamera({ ...s.camera, height: v / 100 }) }).el),
          row('Tilt', INFO.height(), `${Math.round(s.camera.tilt * 100)}`, slider({ min: 0, max: 100, value: Math.round(s.camera.tilt * 100), ends: ['toward horizon', 'straight down'], onInput: (v) => ctl.setCamera({ ...s.camera, tilt: v / 100 }) }).el),
          row('Curve', INFO.height(), s.camera.curve > 0.05 ? 'planet' : s.camera.curve < -0.05 ? 'bowl' : 'flat', slider({ min: -100, max: 100, value: Math.round(s.camera.curve * 100), tick: 0, ends: ['bowl  u', 'flat', 'planet  ∩'], onInput: (v) => ctl.setCamera({ ...s.camera, curve: v / 100 }) }).el),
        ] : d.supportsDepth || id === 'ink' ? [
          row('Zoom', INFO.zoom(name), s.flatZoom === 1 ? 'default' : s.flatZoom.toFixed(2), slider({ min: 0, max: 100, value: Math.round(zoomToSlider(s.flatZoom)), tick: 50, ends: ['close', 'wide'], onInput: (v) => ctl.setFlatZoom(Math.abs(v - 50) <= 2 ? 1 : sliderToZoom(v)), onReset: () => { ctl.setFlatZoom(1); } }).el),
          h('p', { class: 'st-note' }, 'Switch the view to Depth for camera presets.'),
        ] : [h('p', { class: 'st-note', style: { marginTop: '0' } }, `${info.label} moves its own camera with the music.`)]));

    // Feel
    const feel = section('feel', 'feel', forStyle,
      row('Responsiveness', INFO.resp(name), s.responsiveness < 0.34 ? 'smooth' : s.responsiveness > 0.66 ? 'punchy' : 'balanced',
        slider({ min: 0, max: 100, value: Math.round(s.responsiveness * 100), tick: 60, ends: ['smooth', 'punchy'], onInput: (v) => ctl.setResponsiveness(v / 100) }).el));

    // Set Mode
    const inc = h('div', { class: 'st-include' });
    for (const p of PIECES) {
      const on0 = s.setMode.include.length === 0 || s.setMode.include.includes(p.id);
      const t = thumb({ media: mediaFor(p.media), title: p.label, selected: on0, hoverPlay: false, onClick: () => {
        const all = PIECES.map((x) => x.id);
        let list = s.setMode.include.length ? [...s.setMode.include] : all;
        list = list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id];
        s.setMode.include = list.length === all.length ? [] : list;
        ctl.commit();
      } });
      inc.append(t.el);
    }
    const setmode = section('set mode', 'set mode', 'autopilot',
      row('Set Mode', INFO.setmode(), null, toggle('', s.setMode.on, (v) => on.setSetMode(v)).el, true),
      row('What it can choose', INFO.include(), s.setMode.include.length ? `${s.setMode.include.length} of ${PIECES.length}` : 'everything', inc),
      row('At most every', INFO.interval(), fmtInterval(s.setMode.minInterval),
        segmented(SET_MODE_INTERVALS.map((n) => ({ value: String(n), label: fmtInterval(n) })), String(s.setMode.minInterval), (v) => { s.setMode.minInterval = Number(v); ctl.commit(); }, 'Interval').el),
      row('Change palettes too', INFO.setpal(), null, toggle('', s.setMode.palettes, (v) => { s.setMode.palettes = v; ctl.commit(); }).el, true));

    // Now playing
    const np = section('now playing', 'now playing', null,
      row('Show the song', INFO.np(), null, toggle('', s.nowPlaying.show, (v) => { s.nowPlaying.show = v; ctl.commit(); }).el, true),
      row('Position', INFO.np(), s.nowPlaying.position.replace('-', ' '),
        segmented((['top-left', 'top-right', 'bottom-left', 'bottom-right'] as Corner[]).map((c) => ({ value: c, label: c.replace('-', ' ') })), s.nowPlaying.position, (v) => { s.nowPlaying.position = v; ctl.commit(); }, 'Position').el),
      row('Controls', INFO.npControls(), null, toggle('', s.nowPlaying.controls, (v) => { s.nowPlaying.controls = v; ctl.commit(); }).el, true),
      platform.kind === 'web' ? h('p', { class: 'st-note' }, 'Now playing reads the Windows media session, so it only works in the desktop app.') : null);

    // Audio
    const mtr = meter(28);
    const dev = h('span', { class: 'val' });
    unsubs.push(audioStatus.subscribe((a) => { mtr.set(a.level); dev.textContent = a.hearing ? 'hearing music' : 'quiet'; }));
    const audioCtl = platform.kind === 'web'
      ? button('Choose audio source', { onClick: () => { sh.close(); platform.openSourceChooser?.(); } })
      : select([{ value: 'default', label: 'Follow Windows (recommended)' }, ...devices], s.audioDevice, (v) => {
        const lbl = devices.find((x) => x.value === v)?.label ?? '';
        s.audioDevice = v; s.audioDeviceName = v === 'default' ? '' : lbl; ctl.commit(); platform.setDevice(v, lbl);
      }, 'Listen to').el;
    const audio = section('audio', 'audio', null,
      row(platform.kind === 'web' ? 'Source' : 'Listen to', INFO.device(platform.kind), dev, h('div', null, audioCtl, h('div', { style: { marginTop: '14px' } }, mtr.el),
        h('p', { class: 'st-note' }, audioStatus.get().device ? `Now: ${audioStatus.get().device}.` : 'Nothing found yet.'))));

    // Performance
    const perf = section('performance', 'performance', 'all styles',
      row('Quality', INFO.quality(), s.quality, segmented((['low', 'medium', 'high', 'auto'] as QualityPreset[]).map((q) => ({ value: q, label: q })), s.quality, (v) => ctl.setQuality(v), 'Quality').el),
      row('Frame rate', INFO.fps(), s.fpsCap === 0 ? 'max' : `${s.fpsCap} fps`, segmented(FPS_CAPS.map((n) => ({ value: String(n), label: n === 0 ? 'max' : String(n) })), String(s.fpsCap), (v) => ctl.setFpsCap(Number(v)), 'Frame rate').el));

    // System
    const system = section('system', 'system', null,
      row('Open straight into my last visual', INFO.openLast(), null, toggle('', s.openLastVisual, (v) => { s.openLastVisual = v; ctl.commit(); }).el, true),
      platform.listMonitors ? row('Fullscreen display', INFO.monitor(), null,
        select([{ value: '', label: 'Current' }, ...monitors], s.fullscreenMonitor ?? '', (v) => { s.fullscreenMonitor = v || null; ctl.commit(); }, 'Fullscreen display').el) : null,
      platform.checkForUpdate ? row('Check for updates', INFO.updates(), null, toggle('', s.checkUpdates, (v) => { s.checkUpdates = v; ctl.commit(); }).el, true) : null,
      h('div', { class: 'st-row', style: { display: 'flex', gap: '8px' } }, button('Show the intro again', { size: 'sm', onClick: () => { sh.close(); on.replayIntro(); } })));

    const keys = section('keys', 'keys', null, keyList([...SHORTCUTS, [['C'], 'Next camera preset (Depth)']]));
    const about = section('about', 'about', null, h('div', { class: 'st-about' }, lockup(),
      h('p', { class: 's-small', style: { margin: '0' } }, `version ${platform.version}. a visual instrument for whatever’s playing.`),
      h('p', { class: 's-small', style: { margin: '0' } }, 'sonora analyses sound on your computer only. no audio, song or usage data ever leaves it.'),
      h('p', { class: 's-micro', style: { margin: '0' } }, 'fonts: inter and ibm plex mono, sil open font license')));

    const scroll = sh.body.scrollTop;
    content.replaceChildren(visual, colour, camera, feel, setmode, np, audio, perf, system, keys, about);
    sh.body.scrollTop = scroll;
  }

  const rebuild = (): void => {
    if (!sh.isOpen()) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.type === 'range' && sh.el.contains(a)) {
      // Don't rebuild under a dragging slider; do it once it's released.
      a.addEventListener('change', () => build(), { once: true });
      return;
    }
    build();
  };
  ctl.subscribe(rebuild);

  return {
    open(sec?: string) {
      sh.open();
      build();
      void platform.listDevices().then((list) => { devices = list.map((x) => ({ value: x.id, label: x.name })); rebuild(); });
      void platform.listMonitors?.().then((list) => { monitors = list.map((m) => ({ value: m.name, label: m.label })); rebuild(); });
      if (sec) requestAnimationFrame(() => sections[sec]?.scrollIntoView({ block: 'start' }));
    },
    close: () => sh.close(),
    isOpen: () => sh.isOpen(),
  };
}

function cycle(seconds: number): string {
  const m = seconds / 60;
  return m < 1.5 ? `${Math.round(seconds)} s / turn` : `${m.toFixed(m < 10 ? 1 : 0)} min / turn`;
}
const fmtInterval = (s: number): string => (s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);
