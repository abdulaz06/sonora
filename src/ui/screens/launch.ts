/**
 * Launch moment: the glint's lines extend from its dot, the wordmark settles,
 * then the menu takes over. Under 1.5 s, shorter after the first few launches,
 * skipped by any input.
 */

import { h, nextFrame, reducedMotion } from '../ds/dom';
import { lockup } from './brand';

/** Total time on screen (ms): first launches, later launches. */
const FULL_MS = 1350;
const SHORT_MS = 720;

export async function playLaunch(short: boolean): Promise<void> {
  const el = h('div', { class: 'scr scr-launch s-root', 'aria-hidden': 'true' }, lockup());
  if (short) { el.style.setProperty('--launch-line', '380ms'); el.style.setProperty('--launch-word', '160ms'); }
  document.body.append(el);
  if (reducedMotion()) { el.remove(); return; }
  await nextFrame();
  el.classList.add('go');
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', finish, true);
      window.removeEventListener('pointerdown', finish, true);
      resolve();
    };
    window.addEventListener('keydown', finish, true);
    window.addEventListener('pointerdown', finish, true);
    window.setTimeout(finish, short ? SHORT_MS : FULL_MS);
  });
  el.classList.add('out');
  window.setTimeout(() => el.remove(), 420);
}
