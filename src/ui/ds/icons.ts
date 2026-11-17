/** Line icons: 16 px grid, 1.25 px square-capped strokes (Bone via currentColor). */

const wrap = (body: string): string => `<svg class="s-ico" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  arrowRight: wrap('<path d="M2 8h11M9 4l4 4-4 4"/>'),
  arrowLeft: wrap('<path d="M14 8H3M7 4L3 8l4 4"/>'),
  chevronDown: wrap('<path d="M3.5 6l4.5 4.5L12.5 6"/>'),
  close: wrap('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>'),
  menu: wrap('<path d="M2 4.5h12M2 8h12M2 11.5h12"/>'),
  grid: wrap('<path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z"/>'),
  settings: wrap('<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><path d="M9 3v3M12 3v3M4 10v3M7 10v3" />'),
  expand: wrap('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  collapse: wrap('<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5"/>'),
  play: wrap('<path d="M4.5 3v10l8-5z"/>'),
  pause: wrap('<path d="M5 3v10M11 3v10"/>'),
  prev: wrap('<path d="M4 3v10M13 3l-7 5 7 5z"/>'),
  next: wrap('<path d="M12 3v10M3 3l7 5-7 5z"/>'),
  auto: wrap('<path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4"/><path d="M12.5 1.5V4H10M3.5 14.5V12H6"/>'),
  palette: wrap('<path d="M2.5 2.5h5v5h-5zM8.5 8.5h5v5h-5z"/><path d="M8.5 2.5h5v5h-5z" opacity=".45"/><path d="M2.5 8.5h5v5h-5z" opacity=".45"/>'),
  speaker: wrap('<path d="M2.5 6v4h2.5l4 3V3L5 6z"/><path d="M11.5 5.5a3.5 3.5 0 0 1 0 5M13 3.5a6 6 0 0 1 0 9"/>'),
  keyboard: wrap('<path d="M1.5 4h13v8h-13z"/><path d="M4 6.5h1M7 6.5h1M10 6.5h1M4 9.5h8"/>'),
  info: wrap('<path d="M8 7v5M8 4v1"/>'),
  eye: wrap('<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M6.5 8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0"/>'),
  download: wrap('<path d="M8 2v9M4 7.5l4 4 4-4M2.5 14h11"/>'),
} as const;

/** The glint mark (vertical line, short cross line, dot), split into parts for the launch moment. */
export const GLINT = `<svg class="s-glint" viewBox="0 0 200 200" aria-hidden="true">
  <rect class="g-v" x="98.7" y="22" width="2.6" height="156" fill="currentColor"/>
  <rect class="g-h" x="66" y="98.7" width="68" height="2.6" fill="currentColor"/>
  <circle class="g-dot" cx="100" cy="100" r="8" fill="currentColor"/>
</svg>`;
