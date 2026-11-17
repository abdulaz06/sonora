/**
 * UI kit (dev only): every design-system component on one page, for
 * screenshot reviews (scripts/ui-shots.mjs kit).
 */

import { mediaFor } from '../app/catalog';
import {
  button, infoButton, keyList, media, meter, segmented, select, slider, thumb, toast, toggle,
} from '../ui/ds/components';
import { h } from '../ui/ds/dom';
import { lockup } from '../ui/screens/brand';
import '../ui/ds/ds.css';
import '../ui/screens/screens.css';

const css = document.createElement('style');
css.textContent = `
body { margin: 0; overflow: auto; }
.kit { padding: var(--gutter); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--b12); }
.kit > section { background: var(--night); padding: 28px; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.kit .wide { grid-column: span 3; }
.kit .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.kit-head { padding: var(--gutter) var(--gutter) 0; display: flex; justify-content: space-between; align-items: flex-end; }
.kit-head .s-lockup { font-size: 26px; }
.swatches { display: flex; gap: 0; }
.swatches div { width: 120px; height: 72px; padding: 10px; display: flex; align-items: flex-end; border: 1px solid var(--b12); }
html, body { overflow: auto !important; height: auto !important; }
`;
document.head.append(css);
document.body.classList.add('s-root');

const sec = (title: string, ...kids: (Node | null)[]): HTMLElement => h('section', null, h('span', { class: 's-label' }, title), ...kids);
const m = meter(22);
window.setInterval(() => m.set(0.4 + 0.35 * Math.abs(Math.sin(performance.now() / 300))), 60);

document.body.append(
  h('div', { class: 'kit-head' }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } }, lockup(), h('h1', { class: 's-display', style: { fontSize: 'var(--t-hero)', margin: '0' } }, 'ui kit')),
    h('span', { class: 's-micro' }, 'night #08080a · bone #ece7df · greys = bone opacity')),
  h('div', { class: 'kit', style: { marginTop: '32px' } },
    sec('colour', h('div', { class: 'swatches' },
      ...[['night', 'var(--night)'], ['bone', 'var(--bone)'], ['70%', 'var(--b70)'], ['40%', 'var(--b40)'], ['12%', 'var(--b12)']].map(([n, c], i) =>
        h('div', { style: { background: c, color: i === 1 || i === 2 ? 'var(--night)' : 'var(--bone)' } }, h('span', { class: 's-micro', style: { color: 'inherit' } }, n))))),
    sec('type',
      h('div', { class: 's-h1' }, 'a visual instrument'),
      h('div', { class: 's-h3' }, 'for whatever’s playing'),
      h('p', { class: 's-body', style: { margin: '0' } }, 'Body copy is Inter at seventy percent bone. Short sentences, plain words.'),
      h('span', { class: 's-label' }, 'mono label · ibm plex mono')),
    sec('buttons',
      h('div', { class: 'row' }, button('Start', { variant: 'primary', iconAfter: 'arrowRight' }), button('Settings'), button('Menu', { variant: 'ghost', icon: 'grid' })),
      h('div', { class: 'row' }, button('Small', { size: 'sm' }), button('', { icon: 'expand', title: 'Fullscreen' }), button('Large', { size: 'lg', variant: 'primary' }))),
    sec('segmented', segmented([{ value: 'low', label: 'low' }, { value: 'medium', label: 'medium' }, { value: 'high', label: 'high' }, { value: 'auto', label: 'auto' }], 'medium', () => undefined).el,
      segmented([{ value: 'd', label: 'Depth' }, { value: 'f', label: 'Flat' }], 'd', () => undefined).el),
    sec('slider', slider({ min: 0, max: 100, value: 60, tick: 60, ends: ['smooth', 'punchy'], onInput: () => undefined }).el,
      slider({ min: 0, max: 360, value: 200, hue: true, onInput: () => undefined }).el),
    sec('toggle, select', toggle('Colour drift', true, () => undefined).el, toggle('Same colours for every style', false, () => undefined).el,
      select([{ value: 'a', label: 'Follow Windows (recommended)' }, { value: 'b', label: 'Speakers (Realtek(R) Audio)' }], 'a', () => undefined).el),
    sec('thumbnail cards', h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' } },
      thumb({ media: mediaFor('ink-glow'), title: 'Glow', sub: 'Glowing colour on black.', selected: true }).el,
      thumb({ media: mediaFor('ink-marble'), title: 'Marble', sub: 'Two-tone marbling.' }).el,
      thumb({ media: mediaFor('ink-sumi'), title: 'Sumi', sub: 'Ink on paper.' }).el)),
    sec('info (i)', h('div', { class: 'row' }, h('span', { class: 's-small s-bone' }, 'Responsiveness'), infoButton({
      title: 'responsiveness', scope: 'for ink', body: ['How hard the visual moves on each beat.'],
      media: [{ src: mediaFor('explain-resp-smooth'), caption: 'smooth' }, { src: mediaFor('explain-resp-punchy'), caption: 'punchy' }],
      options: [['Smooth', 'Flows and glides.'], ['Punchy', 'Snaps on every hit.']],
    }))), h('div', { class: 'row' }, h('span', { class: 's-chip' }, 'for ink'), h('span', { class: 's-chip' }, 'all styles'))),
    sec('meter, keys', m.el, keyList([[['F'], 'Fullscreen'], [['Esc'], 'Back / menu'], [['M'], 'Set Mode']]),
      button('Show a toast', { size: 'sm', onClick: () => toast('set mode on · sonora chooses') })),
    h('section', { class: 'wide' }, h('span', { class: 's-label' }, 'card + media (still, loop on hover)'),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' } },
        ...['ink', 'silk', 'wisp', 'voyage-city'].map((n) => {
          const md = media(mediaFor(n));
          md.el.style.aspectRatio = '16 / 9';
          const c = h('div', { class: 's-card s-card--hover', style: { padding: '0' } }, md.el, h('div', { style: { padding: '14px 16px' } }, h('span', { class: 's-label s-bone' }, n)));
          c.addEventListener('pointerenter', () => md.play()); c.addEventListener('pointerleave', () => md.stop());
          return c;
        }))),
);
