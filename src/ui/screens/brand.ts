/** The lockup (glint + wordmark), built from the brand files. */

import wordmarkSvg from '../../assets/brand/sonora-wordmark-bone.svg?raw';
import { h, svg } from '../ds/dom';
import { GLINT } from '../ds/icons';

export function lockup(): HTMLSpanElement {
  const word = svg(wordmarkSvg);
  word.classList.add('s-word');
  word.setAttribute('aria-hidden', 'true');
  word.querySelectorAll('[fill]').forEach((n) => n.setAttribute('fill', 'currentColor'));
  return h('span', { class: 's-lockup', role: 'img', 'aria-label': 'sonora' }, svg(GLINT), word);
}

export const glint = (): SVGSVGElement => svg(GLINT);
