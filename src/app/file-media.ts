/**
 * Web: a played file becomes "now playing" (title, artist, album and its
 * embedded cover), so the toast and album colours work as they do with the
 * Windows media session. The file never leaves the browser.
 */

import type { Renderer } from '../engine/renderer';
import { pictureUrl, readTags } from '../audio/tags';
import { nowPlaying, type MediaInfo } from './stores';

export async function fileMedia(data: Blob | ArrayBuffer, label: string): Promise<MediaInfo> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const t = readTags(buf);
  return {
    title: t.title || label.replace(/\.[a-z0-9]+$/i, ''),
    artist: t.artist ?? '',
    album: t.album ?? '',
    art: pictureUrl(t),
    playing: true,
    app: 'file',
    canPrev: false, canNext: false, canPlayPause: false,
  };
}

/** Show the file as now playing and fire the track change. The shell turns a
 * changed now-playing into a track change, except the very first one and a
 * replay of the same song, which are fired here. */
export function announceMedia(info: MediaInfo, renderer: Renderer): void {
  const prev = nowPlaying.get();
  const same = !!prev && prev.title === info.title && prev.artist === info.artist;
  nowPlaying.set(info);
  if (!prev || !prev.title || same) renderer.events.notifyTrackChange({ title: info.title, artist: info.artist });
}
