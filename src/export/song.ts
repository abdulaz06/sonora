/**
 * A song for the Export screen: decoded (mp3, wav, flac, m4a / aac, ogg /
 * opus, or the sound of an mp4 / mov) at 48 kHz stereo, its tags (title,
 * artist, album, artwork) and the whole-song analysis (the real DSP from the
 * very start, as the reel studio). Nothing leaves the device.
 */

import { WasmFrameSource } from '../audio/wasm-source';
import { pictureUrl, readTags } from '../audio/tags';
import type { AudioFeatureFrame } from '../types/audio-frame';
import { analyseFrames, type SongAnalysis } from './analysis';

/** Exports run at this rate (Windows' AAC encoder takes 44.1 or 48 kHz). */
export const SONG_RATE = 48000;
/** Seconds of audio analysed between yields to the page. */
const ANALYSE_CHUNK_S = 6;

export interface Song {
  file: string;
  title: string;
  artist: string;
  album: string;
  /** Embedded artwork (data URL) or ''. */
  cover: string;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  mono: Float32Array;
  duration: number;
  analysis: SongAnalysis;
}

const yieldToPage = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** "Title - Artist.mp3" → title / artist (when the file has no tags). */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const m = base.split(/\s+[-–—]\s+/);
  return m.length >= 2 ? { title: m[0].trim(), artist: m.slice(1).join(' - ').trim() } : { title: base.trim(), artist: '' };
}

/** Tidy store titles: "(Clean)", "(Explicit)", "(feat. …)" go. */
export const tidyTitle = (s: string): string => s.replace(/\s*\((clean|explicit)\)/i, '').replace(/\s*\(feat\..*?\)/i, '').trim();

export async function loadSong(file: File, onProgress: (stage: string, p: number) => void = () => undefined): Promise<Song> {
  onProgress('reading', 0);
  const bytes = await file.arrayBuffer();
  const tags = readTags(bytes);
  onProgress('decoding', 0);
  const ctx = new OfflineAudioContext(2, 1, SONG_RATE);
  let buf: AudioBuffer;
  try { buf = await ctx.decodeAudioData(bytes.slice(0)); } catch { throw new Error('this file has no sound sonora can read'); }
  const left = buf.getChannelData(0).slice();
  const right = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  const named = parseFileName(file.name);
  const title = tidyTitle(tags.title || named.title);
  const artist = tidyTitle(tags.artist || named.artist);
  onProgress('listening', 0);
  const analysis = await analyseSong(mono, SONG_RATE, title, (p) => onProgress('listening', p));
  return { file: file.name, title, artist, album: tags.album ?? '', cover: pictureUrl(tags), sampleRate: SONG_RATE, left, right, mono, duration: mono.length / SONG_RATE, analysis };
}

/** The whole song through the real DSP (WebAssembly) and the shared analysis, yielding as it goes. */
export async function analyseSong(mono: Float32Array, sampleRate: number, title: string, onProgress: (p: number) => void = () => undefined): Promise<SongAnalysis> {
  const src = await WasmFrameSource.create();
  const frames: AudioFeatureFrame[] = [];
  const off = src.subscribe((f) => frames.push(f));
  src.loadOffline(mono, sampleRate);
  const dur = mono.length / sampleRate;
  for (let t = 0; t < dur; t += ANALYSE_CHUNK_S) {
    src.stepOffline(Math.min(ANALYSE_CHUNK_S, dur - t));
    onProgress(Math.min(1, (t + ANALYSE_CHUNK_S) / dur));
    await yieldToPage();
  }
  off();
  return analyseFrames(frames, mono, sampleRate, title);
}
