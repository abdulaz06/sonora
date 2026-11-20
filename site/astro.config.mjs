// Sonora website: static Astro build that imports the real engine from ../src
// (Vite underneath, so GLSL ?raw imports, import.meta.glob media and the
// wasm-pack package work as they do in the app). See DOCS/DECISIONS.md D80–D83.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { SITE_URL, RELEASES_LATEST } from './site.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseFile = new URL('./src/generated/release.json', import.meta.url);
const release = existsSync(releaseFile) ? JSON.parse(readFileSync(releaseFile, 'utf8')) : { url: RELEASES_LATEST };
// On Vercel (`vercel build` sets VERCEL=1) the adapter writes the Build Output
// API, so /download is a real 302 and Web Analytics is injected. Locally the
// build is plain static output for `astro preview`.
const onVercel = !!process.env.VERCEL;

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: true,
  adapter: onVercel ? vercel({ webAnalytics: { enabled: true } }) : undefined,
  integrations: [sitemap({ filter: (page) => !page.includes('/download') && !page.includes('/404') })],
  redirects: {
    '/download': { status: 302, destination: release.url },
  },
  vite: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { fs: { allow: [root] } },
    build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
    worker: { format: 'es' },
  },
});
