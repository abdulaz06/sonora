#!/usr/bin/env node
// Open Graph / Twitter images (1200×630): a real engine frame (from the
// trailer render, verify/site/og-src/<page>.jpg) with the lockup and a line on
// a solid Night block. → public/og/<page>.jpg
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const PAGES = {
  home: { line: 'see your music.', sub: 'a music visualizer for windows · try it live in your browser' },
  live: { line: 'try it live.', sub: 'your music, in your browser · nothing is uploaded' },
  engineering: { line: 'the engineering story.', sub: 'rust dsp · webassembly · webgl 2 · a harness that measures every beat' },
};
const lockup = readFileSync(join(ROOT, 'DOCS', 'brand', 'sonora-lockup-bone.svg'), 'utf8');
const b64 = (p) => readFileSync(p).toString('base64');
const inter = b64(join(ROOT, 'src', 'assets', 'fonts', 'inter-latin-opsz-normal.woff2'));
const mono = b64(join(ROOT, 'src', 'assets', 'fonts', 'ibm-plex-mono-latin-500-normal.woff2'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [name, p] of Object.entries(PAGES)) {
  const frame = b64(join(ROOT, 'verify', 'site', 'og-src', `${name}.jpg`));
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2-variations'); font-weight: 100 900; }
    @font-face { font-family: Mono; src: url(data:font/woff2;base64,${mono}) format('woff2'); font-weight: 500; }
    html, body { margin: 0; width: 1200px; height: 630px; background: #08080A; overflow: hidden; }
    .bg { position: absolute; inset: 0; background: url(data:image/jpeg;base64,${frame}) center / cover; }
    .card { position: absolute; left: 56px; bottom: 56px; background: #08080A; padding: 34px 38px 30px; border: 1px solid rgba(236,231,223,0.12); }
    .card svg { width: 300px; height: auto; display: block; }
    .line { font-family: Inter; font-weight: 600; font-variation-settings: 'opsz' 32; font-size: 52px; letter-spacing: -0.035em; color: #ECE7DF; margin-top: 22px; line-height: 1; }
    .sub { font-family: Mono; font-weight: 500; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(236,231,223,0.62); margin-top: 18px; }
  </style></head><body><div class="bg"></div><div class="card">${lockup}<div class="line">${p.line}</div><div class="sub">${p.sub}</div></div></body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SITE, 'public', 'og', `${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log(`og: ${name}`);
}
await browser.close();
