#!/usr/bin/env node
// Resolves the latest GitHub release at build time: version, the NSIS
// installer asset (direct link) and its size → src/generated/release.json.
// The page refreshes this client-side (sessionStorage-cached), and /download
// redirects to the installer. Falls back to releases/latest on any failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, RELEASES_LATEST } from '../site.config.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(SITE, 'src', 'generated', 'release.json');
mkdirSync(dirname(out), { recursive: true });
const pkg = JSON.parse(readFileSync(join(SITE, '..', 'package.json'), 'utf8'));

/** The installer: the NSIS setup exe (tauri-action names it <product>_<version>_x64-setup.exe). */
export const pickInstaller = (assets) => assets.find((a) => /-setup\.exe$/i.test(a.name)) ?? assets.find((a) => /\.msi$/i.test(a.name));

let release = { version: pkg.version, tag: `v${pkg.version}`, url: RELEASES_LATEST, asset: null, size: 0, publishedAt: null, resolved: false };
try {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'sonora-site-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const j = await r.json();
  const a = pickInstaller(j.assets ?? []);
  if (!a) throw new Error('no installer asset');
  release = { version: String(j.tag_name).replace(/^v/, ''), tag: j.tag_name, url: a.browser_download_url, asset: a.name, size: a.size, publishedAt: j.published_at, resolved: true };
} catch (e) {
  console.warn(`release: could not resolve the latest release (${e.message}); falling back to ${RELEASES_LATEST}`);
}
writeFileSync(out, JSON.stringify(release, null, 1));
console.log(`release: ${release.tag} → ${release.asset ?? release.url}${release.size ? ` (${(release.size / 1048576).toFixed(1)} MB)` : ''}`);
