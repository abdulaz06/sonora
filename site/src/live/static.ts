/**
 * /live on a phone or without WebGL 2: recordings from the engine instead of
 * the live app (whose code then never loads).
 */

import { refreshDownloads } from '../lib/download';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

export function bootStatic(): void {
  void refreshDownloads();
  staticMode();
}

export function staticMode(): void {
  const why = document.documentElement.dataset.why;
  if (why === 'webgl') {
    const t = $('[data-fb-title]'), b = $('[data-fb-body]');
    if (t) t.textContent = 'the visuals can’t start in this browser.';
    if (b) b.textContent = 'sonora draws with WebGL 2 and high-precision render targets, and this browser or graphics driver doesn’t offer them. Updating the graphics driver, or trying Chrome or Edge, usually fixes it. Meanwhile, here is what it looks like, recorded from the engine.';
  }
  // The recordings load only here (the live page never fetches them); still with reduced motion.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll<HTMLVideoElement>('.lv-fallback video').forEach((v) => {
    if (v.dataset.poster) v.poster = v.dataset.poster;
    const src = v.dataset.loop;
    if (!src || still) return;
    v.src = src;
    v.autoplay = true;
    void v.play().catch(() => undefined);
  });
}
