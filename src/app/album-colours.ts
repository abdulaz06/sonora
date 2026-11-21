/**
 * Album colours: the palette follows the cover art of what's playing.
 *
 * The cover arrives with now playing (the Windows media session, or a dropped
 * file's embedded artwork on the web). It is decoded and downscaled on this
 * device, clustered (engine/album-palette.ts) and handed to the colour engine,
 * which crossfades to it over ~2.5 s, in step with the now-playing toast. The
 * cover never leaves the device.
 *
 * Falls back to the user's chosen palette when there is no cover, for ads, and
 * for grey or black-and-white covers. A new track from the same album changes
 * nothing. A cover that disappears for a moment (between tracks) keeps its
 * colours for GRACE_MS before the fallback.
 */

import { COVER_SIZE, extractAlbum } from '../engine/album-palette';
import type { Palette } from '../engine/color-engine';
import type { ColorEngine } from '../engine/color-engine';
import { Store, type MediaInfo } from './stores';

// ── Tuning ──────────────────────────────────────────────────────
/** How long a vanished cover keeps its colours before the fallback (ms). */
const GRACE_MS = 4000;
/** Covers remembered (album key → palette), so going back to an album is instant. */
const CACHE_SIZE = 48;

export type AlbumStatus =
  /** A cover with colours: its palette drives while album colours are on. */
  | 'cover'
  /** Nothing playing, or no cover (podcast, some players). */
  | 'none'
  /** An advert. */
  | 'ad'
  /** A grey or black-and-white cover. */
  | 'grey';

export interface AlbumState {
  status: AlbumStatus;
  /** The current cover (data: URL), '' when none. */
  art: string;
  /** The album palette for the current cover (also while album colours are off). */
  palette: Palette | null;
}

export interface AlbumColours {
  readonly state: Store<AlbumState>;
  /** Feed every now-playing update. */
  feed(m: MediaInfo | null): void;
  /** Album colours were switched on or off: apply or release the palette. */
  refresh(): void;
}

/** Adverts as players report them (Spotify: "Advertisement" or the app's own
 * name, no artist). */
export function isAd(m: MediaInfo): boolean {
  const t = m.title.trim().toLowerCase();
  if (t === 'advertisement' || t === 'spotify' || t === 'spotify free') return true;
  return /spotify/i.test(m.app) && !m.artist.trim();
}

/** A stable key for a cover's content (same album → same thumbnail bytes). */
export function coverKey(art: string): string {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(art.length / 4096));
  for (let i = 0; i < art.length; i += step) { h ^= art.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${art.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** Decode a cover (data:/blob: URL) and draw it at COVER_SIZE² for clustering. */
export async function coverPixels(src: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const bmp = await createImageBitmap(img, { resizeWidth: COVER_SIZE, resizeHeight: COVER_SIZE, resizeQuality: 'high' });
    const cv = document.createElement('canvas');
    cv.width = COVER_SIZE; cv.height = COVER_SIZE;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const d = g.getImageData(0, 0, COVER_SIZE, COVER_SIZE);
    return { data: d.data, width: COVER_SIZE, height: COVER_SIZE };
  } catch {
    return null;
  }
}

/** Extract a cover's palette in the browser (null: grey or unreadable). */
export async function paletteFromArt(src: string): Promise<Palette | null> {
  const px = await coverPixels(src);
  return px ? extractAlbum(px.data, px.width, px.height).palette : null;
}

export function createAlbumColours(engine: ColorEngine, isOn: () => boolean): AlbumColours {
  const state = new Store<AlbumState>({ status: 'none', art: '', palette: null });
  const cache = new Map<string, Palette | null>();
  let key = '';
  let seq = 0;
  let graceTimer = 0;

  const apply = (): void => {
    const s = state.get();
    engine.setAlbum(isOn() && s.palette ? s.palette : null);
  };
  // The cover is gone: keep its colours a moment (track gaps), then fall back.
  const release = (status: AlbumStatus, art = ''): void => {
    key = '';
    seq++;
    window.clearTimeout(graceTimer);
    graceTimer = window.setTimeout(() => { state.set({ status, art, palette: null }); apply(); }, GRACE_MS);
  };

  return {
    state,
    feed(m) {
      if (!m || !m.title) { release('none'); return; }
      if (isAd(m)) { release('ad', m.art); return; }
      if (!m.art) { release('none'); return; }
      const k = coverKey(m.art);
      if (k === key) return;
      window.clearTimeout(graceTimer);
      key = k;
      const mine = ++seq;
      const done = (p: Palette | null): void => {
        if (mine !== seq) return;   // a newer cover arrived meanwhile
        state.set({ status: p ? 'cover' : 'grey', art: m.art, palette: p });
        apply();
      };
      if (cache.has(k)) { done(cache.get(k) ?? null); return; }
      void paletteFromArt(m.art).then((p) => {
        cache.set(k, p);
        if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
        done(p);
      });
    },
    refresh: apply,
  };
}
