/**
 * First run (once, skippable): what sonora is, an audio check with the live
 * meter, how choosing works (style / look / view / palette, defined once),
 * and the shortcuts that matter.
 */

import { mediaFor, SHORTCUTS } from '../../app/catalog';
import { audioStatus } from '../../app/stores';
import { button, keyList, media, meter, thumb } from '../ds/components';
import { h } from '../ds/dom';
import { glint, lockup } from './brand';

/** Seconds of silence on the audio check before the troubleshooting tips appear. */
const TROUBLE_AFTER_S = 12;

export interface OnboardingHandlers { done(): void; openAudio(): void }

export function runOnboarding(platform: 'desktop' | 'web', on: OnboardingHandlers): HTMLElement {
  const stage = media(mediaFor('ink'), { large: true, eager: true });
  const cap = h('span', { class: 'i-cap s-label s-bone' });
  const steps = h('div', { class: 'steps' }, h('i'), h('i'), h('i'), h('i'));
  const skip = button('Skip intro', { variant: 'ghost', onClick: () => finish() });
  const body = h('div', { class: 'i-body' });
  const foot = h('div', { class: 'i-foot' });
  const el = h('section', { class: 'scr scr-intro s-root', 'aria-label': 'Welcome' },
    h('div', { class: 'i-media' }, stage.el, cap),
    h('div', { class: 'i-side' }, h('div', { class: 'i-top' }, lockup(), skip), body, foot));
  let step = 0;
  let unsub: (() => void) | null = null;

  const finish = (): void => { unsub?.(); stage.stop(); on.done(); };
  const next = (): void => { step++; render(); };

  function setStage(name: string, label: string): void {
    stage.set(mediaFor(name));
    stage.play();
    cap.textContent = label;
  }

  function render(): void {
    unsub?.(); unsub = null;
    steps.querySelectorAll('i').forEach((x, k) => x.classList.toggle('on', k === step));
    body.className = 'i-body step-in';
    void body.offsetWidth;
    if (step === 0) {
      setStage('ink', 'ink · glow');
      body.replaceChildren(
        h('span', { class: 's-label' }, 'see your music'),
        h('h1', { class: 's-h1' }, 'a visual instrument for whatever’s playing.'),
        h('p', { class: 's-body' }, 'sonora listens to the music on your PC and turns it into moving pictures, in time with every beat. nothing to set up, no account, and no sound ever leaves your computer.'));
      foot.replaceChildren(steps, button('Begin', { variant: 'primary', iconAfter: 'arrowRight', onClick: next }));
    } else if (step === 1) {
      setStage('silk', 'silk');
      const m = meter(32);
      const status = h('div', { class: 'heard' });
      const trouble = h('div', { class: 'trouble', hidden: true },
        h('span', { class: 's-label' }, 'not hearing anything yet'),
        h('ol', { class: 's-small' },
          h('li', null, 'Make sure something is actually playing, and the volume isn’t muted.'),
          platform === 'web'
            ? h('li', null, 'In the browser, choose a source: share a tab with music, play a file, or use the microphone.')
            : h('li', null, 'Check which speakers or headphones sonora listens to. It follows the ones Windows uses unless you pick one.'),
          h('li', null, 'Some apps play to a different output (a headset, a TV). Pick that output instead.')),
        button(platform === 'web' ? 'Choose a source' : 'Choose output', { onClick: () => on.openAudio() }));
      const cont = button('Continue', { variant: 'primary', iconAfter: 'arrowRight', onClick: next });
      body.replaceChildren(
        h('span', { class: 's-label' }, 'audio check'),
        h('h1', { class: 's-h1' }, 'play something now.'),
        h('p', { class: 's-body' }, platform === 'web'
          ? 'any music works. choose where sonora listens: a browser tab, a file or the microphone.'
          : 'spotify, youtube, a game, anything. sonora listens to whatever your PC is playing.'),
        h('div', { class: 'big-meter' }, m.el, status),
        trouble);
      foot.replaceChildren(steps, h('div', { style: { display: 'flex', gap: '8px' } }, button('Not now', { variant: 'ghost', onClick: next }), cont));
      let heardOnce = false;
      unsub = audioStatus.subscribe((a) => {
        m.set(a.level);
        if (a.hearing) heardOnce = true;
        if (heardOnce) {
          status.replaceChildren(glint(), h('span', { class: 's-label s-bone' }, 'got it. sonora can hear your music.'));
          trouble.hidden = true;
        } else {
          status.replaceChildren(h('span', { class: 's-label' }, a.device ? `listening to ${a.device}` : 'waiting for sound…'));
          trouble.hidden = !(a.silentFor >= TROUBLE_AFTER_S);
        }
      });
    } else if (step === 2) {
      setStage('voyage-city', 'voyage · city');
      const term = (name: string, title: string, sub: string) => thumb({ media: mediaFor(name), title, sub, hoverPlay: false });
      body.replaceChildren(
        h('span', { class: 's-label' }, 'choosing'),
        h('h1', { class: 's-h1' }, 'styles, looks and views.'),
        h('div', { class: 'terms' },
          term('ink', 'Style', 'the kind of visual: ink, silk, wisp, warp or voyage.').el,
          term('ink-sumi', 'Look', 'a variation of a style, like sumi for ink.').el,
          term('ink-view-flat', 'View', 'depth is a 3d camera. flat is a 2d canvas.').el),
        h('p', { class: 's-small' }, 'a palette is the set of colours. every style keeps its own settings, and every setting has an (i) button that explains it in plain words.'));
      foot.replaceChildren(steps, button('Next', { variant: 'primary', iconAfter: 'arrowRight', onClick: next }));
    } else {
      setStage('wisp', 'wisp');
      body.replaceChildren(
        h('span', { class: 's-label' }, 'keys'),
        h('h1', { class: 's-h1' }, 'a few keys.'),
        keyList(SHORTCUTS.filter(([k]) => ['F', 'Esc', 'H', 'M', 'S', 'V'].includes(k[0]))),
        h('p', { class: 's-small' }, 'move the mouse to bring the controls back. the full list is in settings.'));
      foot.replaceChildren(steps, button('Enter sonora', { variant: 'primary', iconAfter: 'arrowRight', onClick: finish }));
    }
    window.setTimeout(() => foot.querySelector<HTMLElement>('.s-btn--primary')?.focus({ preventScroll: true, focusVisible: false } as FocusOptions), 60);
  }

  document.body.append(el);
  render();
  return el;
}
