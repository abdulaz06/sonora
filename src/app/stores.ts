/**
 * Small observable stores the screens read: audio status (device, live level,
 * whether music is heard) and now playing (the media session).
 */

type Listener<T> = (v: T) => void;

export class Store<T> {
  private listeners: Listener<T>[] = [];
  constructor(private value: T) {}
  get(): T { return this.value; }
  set(v: T): void { this.value = v; for (const l of this.listeners) l(v); }
  patch(p: Partial<T>): void { this.set({ ...this.value, ...p }); }
  subscribe(l: Listener<T>, now = true): () => void {
    this.listeners.push(l);
    if (now) l(this.value);
    return () => { const i = this.listeners.indexOf(l); if (i >= 0) this.listeners.splice(i, 1); };
  }
}

// ── Audio status ────────────────────────────────────────────────
/** Level above which sound counts as music (sqrt-energy scale, 0–1). */
const HEAR_LEVEL = 0.035;
/** Sound must last this long to count as heard (s), and silence this long to drop it. */
const HEAR_ON_S = 0.35;
const HEAR_OFF_S = 2.5;

export interface AudioStatus {
  /** What's being listened to (device or source name); '' = nothing yet. */
  device: string;
  /** Pinned to a device instead of following Windows. */
  pinned: boolean;
  /** Smoothed live level 0–1. */
  level: number;
  /** Music is coming through. */
  hearing: boolean;
  /** Seconds since sound was last heard (Infinity before the first). */
  silentFor: number;
}

export const audioStatus = new Store<AudioStatus>({ device: '', pinned: false, level: 0, hearing: false, silentFor: Infinity });

let loudFor = 0, quietFor = 0, lastT = 0, smooth = 0, everHeard = false;
/** Feed every analysis frame's level (called from the controller's level listener). */
export function feedLevel(level: number): void {
  const now = performance.now() / 1000;
  const dt = lastT ? Math.min(0.2, now - lastT) : 1 / 60;
  lastT = now;
  smooth = Math.max(level, smooth * Math.exp(-dt / 0.12));
  const s = audioStatus.get();
  let hearing = s.hearing;
  if (level > HEAR_LEVEL) { loudFor += dt; quietFor = 0; } else { quietFor += dt; loudFor = 0; }
  if (!hearing && loudFor >= HEAR_ON_S) { hearing = true; everHeard = true; }
  if (hearing && quietFor >= HEAR_OFF_S) hearing = false;
  const silentFor = hearing ? 0 : everHeard ? quietFor : (s.silentFor === Infinity ? 0 : s.silentFor) + dt;
  // Throttle store updates to ~30 Hz.
  if (Math.abs(smooth - s.level) > 0.01 || hearing !== s.hearing || Math.floor(silentFor) !== Math.floor(s.silentFor)) {
    audioStatus.patch({ level: smooth, hearing, silentFor });
  }
}

// ── Now playing ─────────────────────────────────────────────────
export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  /** Album art as a data: URL ('' if none). */
  art: string;
  playing: boolean;
  /** Player app id (e.g. Spotify.exe). */
  app: string;
  canPrev: boolean;
  canNext: boolean;
  canPlayPause: boolean;
}
export const nowPlaying = new Store<MediaInfo | null>(null);
