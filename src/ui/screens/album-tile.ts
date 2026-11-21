/**
 * The "Album" tile, first in every palette picker (settings, quick switcher,
 * controller): the current cover, the colours taken from it, and a plain hint
 * when there's nothing to take colours from (it greys out; your palette stays).
 */

import type { AlbumState } from '../../app/album-colours';
import { mediaFor } from '../../app/catalog';
import { resolvePalette } from '../../engine/color-engine';
import type { InfoContent } from '../ds/components';
import { h } from '../ds/dom';

/** Why the cover can't give colours right now (null: it can). */
export function albumHint(a: AlbumState, web: boolean): string | null {
  if (a.status === 'cover') return null;
  if (a.status === 'grey') return 'cover has no colour';
  if (a.status === 'ad') return 'advert';
  return web ? 'play a file with a cover' : 'nothing playing';
}

export function albumTile(a: AlbumState, on: boolean, web: boolean, onClick: () => void, small = false): HTMLButtonElement {
  const hint = albumHint(a, web);
  // The cover, then the colours taken from it as flat bands.
  const art = a.art ? h('img', { src: a.art, alt: '', draggable: 'false', class: 'album-art' }) : null;
  const css = (c: [number, number, number]): string => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
  const r = a.palette ? resolvePalette(a.palette) : null;
  const bands = r ? h('span', { class: 'album-bands', 'aria-hidden': 'true' }, ...[r.primary, r.secondary, r.accent, r.highlight].map((c) => h('i', { style: { background: css(c) } }))) : null;
  const mediaEl = h('div', { class: 's-media', style: { position: 'relative' } },
    art ?? h('span', { class: 'album-ph', 'aria-hidden': 'true' }, h('i')), bands);
  const el = h('button', {
    class: `s-thumb pal-thumb album-thumb${hint ? ' is-dim' : ''}`, type: 'button', 'aria-pressed': String(on),
    title: hint ? `Album colours: ${hint} (your palette stays until a cover plays)` : 'Colours from the album art of what’s playing',
  }, mediaEl,
  h('span', { class: 's-thumb-row' }, h('span', { class: 's-thumb-title' }, 'Album'), !small && hint ? h('span', { class: 's-thumb-mark' }, '·') : null),
  !small && hint ? h('span', { class: 's-thumb-sub' }, hint) : null);
  el.addEventListener('click', onClick);
  return el;
}

/** The (i) card for album colours, with a picture example. */
export function albumInfo(web: boolean): InfoContent {
  return {
    title: 'album colours',
    scope: 'all styles',
    body: [
      'sonora paints with the colours of the cover of what’s playing. When the track changes, the new album’s colours fade in over a couple of seconds; the next song from the same album keeps them.',
      web ? 'In the browser it reads the artwork inside the audio file you play (mp3, m4a, flac).' : 'It reads the cover your music app reports to Windows (Spotify, browsers, most players).',
      'No cover, an advert, or a black-and-white cover: your own palette stays. Picking a palette by hand turns album colours off; the Album tile turns them back on. Colour drift pauses while a cover chooses the colours.',
      'The cover never leaves your computer: it is read and analysed on this device only.',
    ],
    media: [{ src: mediaFor('explain-album-cover'), caption: 'the cover' }, { src: mediaFor('explain-album'), caption: 'its colours' }],
  };
}
