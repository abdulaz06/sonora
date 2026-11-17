/**
 * Style detail: a big preview, the looks and views as labelled thumbnails
 * (each with a one-line explanation) and a clear Start. Picking a look or
 * view updates the preview at once.
 */

import { ART_STYLES, mediaFor, mediaNameFor, STYLE_INFO } from '../../app/catalog';
import type { Controller } from '../../app/controller';
import { getStyle } from '../../styles/registry';
import type { StyleId } from '../../styles/visual-style';
import { button, media, thumb, type Thumb } from '../ds/components';
import { h } from '../ds/dom';
import { lockup } from './brand';

export interface DetailHandlers {
  back(): void;
  start(id: StyleId, look: string, depth: boolean, from: HTMLElement): void;
}

export interface DetailScreen { el: HTMLElement; open(id: StyleId): void; hide(): void; current(): StyleId }

export function createDetail(ctl: Controller, on: DetailHandlers): DetailScreen {
  const stage = media({ still: '' }, { large: true, eager: true });
  const stageLabel = h('span', { class: 's-label s-bone' });
  const stageNote = h('span', { class: 's-micro' });
  const counter = h('span', { class: 's-micro' });
  const backBtn = button('Menu', { variant: 'ghost', icon: 'arrowLeft', onClick: () => on.back() });
  const top = h('header', { class: 'topbar' }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '28px' } }, lockup(), backBtn), counter);
  const side = h('div', { class: 'side' });
  const el = h('section', { class: 'scr scr-detail s-root', hidden: true, 'aria-label': 'Style' }, top,
    h('div', { class: 'd-wrap' },
      h('div', { class: 'stage' }, stage.el, h('div', { class: 'stage-cap' }, stageLabel, stageNote)),
      side));

  let style: StyleId = 'ink';
  let look = '';
  let depth = false;

  function preview(): void {
    const name = mediaNameFor(style, look, depth);
    stage.set(mediaFor(name, style));
    stage.el.querySelector('img')?.classList.add('fade-in');
    stage.play();
    const info = STYLE_INFO[style];
    const l = info.looks.find((x) => x.id === look);
    const d = getStyle(style);
    stageLabel.textContent = [info.label, l && (!l.depthOnly || depth) ? l.label : '', d.supportsDepth ? (depth ? 'Depth' : 'Flat') : '']
      .filter(Boolean).join(' · ');
    stageNote.textContent = 'preview · recorded from sonora';
  }

  function build(): void {
    const info = STYLE_INFO[style];
    const d = getStyle(style);
    const i = ART_STYLES.indexOf(style);
    counter.textContent = i >= 0 ? `${String(i + 1).padStart(2, '0')} / ${String(ART_STYLES.length).padStart(2, '0')}` : 'classic';
    side.replaceChildren();
    side.append(
      h('h1', { class: 's-display nm' }, info.label.toLowerCase()),
      h('p', { class: 'more', style: { margin: '0' } }, info.more),
      h('div', { class: 'suits s-micro' }, `suits ${info.suits}${info.heavy ? ' · heavy on the graphics card' : ''}`));

    const lookThumbs: Thumb[] = [];
    const viewThumbs: Thumb[] = [];
    const sync = (): void => {
      lookThumbs.forEach((t, k) => t.setSelected(info.looks[k].id === look && (!info.looks[k].depthOnly || depth)));
      viewThumbs.forEach((t, k) => t.setSelected((k === 0) === depth));
      preview();
    };

    if (info.looks.length) {
      const opts = h('div', { class: info.looks.length === 2 ? 'opts two' : 'opts' });
      for (const l of info.looks) {
        const t = thumb({
          media: mediaFor(l.media), title: l.label, sub: l.line,
          onClick: () => { look = l.id; if (l.depthOnly) depth = true; sync(); },
        });
        lookThumbs.push(t);
        opts.append(t.el);
      }
      const note = info.looks.some((l) => l.depthOnly) ? 'depth view' : `${info.looks.length} looks`;
      side.append(h('div', { class: 'grp' }, h('div', { class: 'grp-head' }, h('span', { class: 's-label' }, 'look'), h('span', { class: 's-micro' }, note)), opts));
    }
    if (d.supportsDepth && info.views) {
      const opts = h('div', { class: 'opts two' });
      const views: [boolean, string, string][] = [[true, 'Depth', info.views.depth], [false, 'Flat', info.views.flat]];
      for (const [dp, label, line] of views) {
        const t = thumb({ media: mediaFor(`${style}-view-${dp ? 'depth' : 'flat'}`), title: label, sub: line, onClick: () => { depth = dp; sync(); } });
        viewThumbs.push(t);
        opts.append(t.el);
      }
      side.append(h('div', { class: 'grp' }, h('div', { class: 'grp-head' }, h('span', { class: 's-label' }, 'view'), h('span', { class: 's-micro' }, 'depth = 3d camera · flat = 2d canvas')), opts));
    }
    const startBtn = button('Start', { variant: 'primary', size: 'lg', iconAfter: 'arrowRight', onClick: () => on.start(style, look, depth, stage.el) });
    side.append(h('div', { class: 'go-row' }, startBtn, h('span', { class: 's-micro' }, 'enter')));
    sync();
  }

  return {
    el,
    open(id: StyleId) {
      style = id;
      look = ctl.variantFor(id);
      depth = ctl.depthFor(id);
      build();
      el.hidden = false;
      el.classList.remove('is-in');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
      window.setTimeout(() => el.querySelector<HTMLElement>('.s-btn--primary')?.focus({ preventScroll: true, focusVisible: false } as FocusOptions), 80);
    },
    hide() { el.hidden = true; stage.stop(); },
    current: () => style,
  };
}
