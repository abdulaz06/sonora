/**
 * The cover of what's playing, decoded once for the Cover style (and anything
 * else that wants the artwork itself, not just its colours). The app feeds it
 * from now playing (album colours' state); exports and the harness set it
 * directly. Decoding happens off the render path; renderers upload the bitmap
 * when its version changes.
 */

// ── Tuning ──────────────────────────────────────────────────────
/** Largest side the cover is decoded at (px). */
const COVER_MAX = 1024;

export interface CoverArt {
  /** A stable key for the artwork's content. */
  key: string;
  image: ImageBitmap;
  /** Bumped on every change (renderers re-upload). */
  version: number;
}

let current: CoverArt | null = null;
let version = 0;
let pendingKey = '';
const listeners = new Set<(c: CoverArt | null) => void>();

/** The current cover, or null when nothing (or nothing with artwork) plays. */
export const coverArt = (): CoverArt | null => current;

/** Hear about cover changes (Set Mode leaves Cover out while there's none). */
export function onCoverArt(cb: (c: CoverArt | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function emit(): void { for (const l of listeners) l(current); }

/** Set the cover from an image URL (data:, blob: or same-origin); '' clears it. */
export async function setCoverArt(src: string, key = src.slice(0, 64) + src.length): Promise<void> {
  if (!src) {
    pendingKey = '';
    if (current) { current.image.close(); current = null; version++; emit(); }
    return;
  }
  if (current?.key === key || pendingKey === key) return;
  pendingKey = key;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const s = Math.min(1, COVER_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const bmp = await createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(img.naturalWidth * s)), resizeHeight: Math.max(1, Math.round(img.naturalHeight * s)), resizeQuality: 'high' });
    if (pendingKey !== key) { bmp.close(); return; }
    current?.image.close();
    current = { key, image: bmp, version: ++version };
    pendingKey = '';
    emit();
  } catch {
    if (pendingKey === key) pendingKey = '';
  }
}
