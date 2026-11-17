/**
 * The signature transition: the chosen thumbnail grows to fill the screen,
 * then dissolves into the live render underneath.
 */

import { h, nextFrame, reducedMotion, wait } from '../ds/dom';

/** Clone `from`'s picture into a fixed layer and fly it to full screen. Resolves when it covers the screen. */
export async function expandFrom(from: HTMLElement): Promise<{ dissolve(): Promise<void> }> {
  const r = from.getBoundingClientRect();
  const src = from.querySelector('video.s-on, video') as HTMLVideoElement | null;
  const img = from.querySelector('img');
  const layer = h('div', { class: 's-expander' });
  // A playing loop keeps playing as it grows; otherwise the still.
  if (src && from.classList.contains('is-playing') && src.readyState >= 2) {
    const v = h('video', { muted: true, playsinline: true, loop: true });
    v.muted = true;
    v.src = src.currentSrc || src.src;
    v.currentTime = src.currentTime;
    void v.play().catch(() => undefined);
    layer.append(v);
  } else if (img) {
    layer.append(h('img', { src: img.currentSrc || img.src, alt: '' }));
  }
  Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(layer);
  if (!reducedMotion()) {
    await nextFrame();
    layer.classList.add('fly');
    Object.assign(layer.style, { left: '0px', top: '0px', width: `${window.innerWidth}px`, height: `${window.innerHeight}px` });
    await wait(720);
  } else {
    Object.assign(layer.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
  }
  return {
    async dissolve() {
      layer.classList.add('dissolve');
      await wait(900);
      layer.remove();
    },
  };
}
