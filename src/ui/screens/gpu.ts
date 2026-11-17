/** Shown instead of a black screen when the graphics card can't run sonora. */

import { h } from '../ds/dom';
import { lockup } from './brand';
import '../ds/ds.css';
import './screens.css';

export function showGpuFallback(reason: 'webgl2' | 'float' | 'other', detail = ''): void {
  const what = reason === 'webgl2'
    ? 'This computer’s graphics driver doesn’t offer WebGL 2, which sonora draws with.'
    : reason === 'float'
      ? 'This graphics card can’t render the high-precision images sonora’s visuals need.'
      : 'sonora couldn’t start its graphics.';
  document.body.classList.add('s-root');
  document.body.append(h('section', { class: 'scr scr-gpu s-root', role: 'alert' },
    lockup(),
    h('h1', { class: 's-h1' }, 'the visuals can’t start on this graphics card.'),
    h('p', { class: 's-body' }, what),
    h('p', { class: 's-body' }, 'Updating the graphics driver usually fixes it (from your PC maker, or from AMD, NVIDIA or Intel). On laptops with two graphics chips, set sonora to use the high-performance one in Windows Settings › System › Display › Graphics.'),
    detail ? h('p', { class: 's-micro' }, detail) : null));
}

export function gpuReason(err: unknown): 'webgl2' | 'float' | 'other' {
  const m = err instanceof Error ? err.message : String(err);
  return m.includes('WebGL 2') ? 'webgl2' : m.includes('float') ? 'float' : 'other';
}
