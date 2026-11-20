/** Build-time release info (scripts/release.mjs), with display helpers. */
import data from '../generated/release.json';

export interface Release { version: string; tag: string; url: string; asset: string | null; size: number; publishedAt: string | null; resolved: boolean }
export const release = data as Release;
export const sizeLabel = (bytes: number): string => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');
export const metaLabel = (r: Release): string => [`v${r.version}`, sizeLabel(r.size), 'Windows 10 / 11'].filter(Boolean).join(' · ');
