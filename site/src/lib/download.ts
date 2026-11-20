/**
 * Keeps every download link on the latest release without a redeploy: asks
 * the GitHub API once per session (sessionStorage, so it never hits the rate
 * limit), then updates [data-dl] links and [data-dl-meta] labels.
 * Falls back silently to the build-time values.
 */
import { REPO } from '../../site.config.mjs';

// ── Tuning ──────────────────────────────────────────────────────
const CACHE_KEY = 'sonora.release.v1';
const CACHE_MS = 60 * 60 * 1000;

interface Latest { version: string; url: string; size: number; at: number }

const label = (l: Latest): string => [`v${l.version}`, l.size ? `${(l.size / 1048576).toFixed(1)} MB` : '', 'Windows 10 / 11'].filter(Boolean).join(' · ');

export function pickInstaller(assets: { name: string; browser_download_url: string; size: number }[]): { url: string; size: number } | null {
  const a = assets.find((x) => /-setup\.exe$/i.test(x.name)) ?? assets.find((x) => /\.msi$/i.test(x.name));
  return a ? { url: a.browser_download_url, size: a.size } : null;
}

async function latest(): Promise<Latest | null> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as Latest | null;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  } catch { /* storage blocked */ }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] };
    const a = pickInstaller(j.assets ?? []);
    if (!a) return null;
    const l: Latest = { version: j.tag_name.replace(/^v/, ''), url: a.url, size: a.size, at: Date.now() };
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(l)); } catch { /* storage blocked */ }
    return l;
  } catch {
    return null;
  }
}

export async function refreshDownloads(): Promise<void> {
  const l = await latest();
  if (!l) return;
  // Only touch what changed (an unchanged page shouldn't repaint).
  const set = (e: HTMLElement, text: string): void => { if (e.textContent !== text) e.textContent = text; };
  document.querySelectorAll<HTMLAnchorElement>('a[data-dl]').forEach((a) => { if (a.href !== l.url) a.href = l.url; });
  document.querySelectorAll<HTMLElement>('[data-dl-meta]').forEach((e) => set(e, label(l) + (e.dataset.dlSuffix ?? '')));
  document.querySelectorAll<HTMLElement>('[data-dl-version]').forEach((e) => set(e, `v${l.version}`));
}
