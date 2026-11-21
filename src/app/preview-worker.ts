/// <reference lib="webworker" />
/**
 * Preview encoder (runs off the output's main thread): a downscaled bitmap
 * (or raw RGBA, bottom-up, from a readPixels capture) from the preview tap →
 * JPEG → the preview channel. A pixel buffer goes straight back to the tap's pool.
 */

import { PREVIEW_CHANNEL, type PreviewMsg } from './link';

/** JPEG quality of preview frames. */
const QUALITY = 0.8;

const ch = new BroadcastChannel(PREVIEW_CHANNEL);
let canvas: OffscreenCanvas | null = null;
let g: OffscreenCanvasRenderingContext2D | null = null;
let busy = false;

self.onmessage = async (e: MessageEvent<{ buf?: ArrayBuffer; bmp?: ImageBitmap; w: number; h: number; at: number; seq: number }>) => {
  const { buf, bmp, w, h, at, seq } = e.data;
  const back = (sent: boolean): void => { if (buf) (self as unknown as Worker).postMessage({ buf, sent }, [buf]); };
  // One frame in the encoder at a time: a newer frame supersedes a late one.
  if (busy) { bmp?.close(); back(false); return; }
  busy = true;
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); g = canvas.getContext('2d'); }
    if (bmp) { g!.drawImage(bmp, 0, 0, w, h); bmp.close(); } else if (buf) { g!.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0); back(true); }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    // readPixels rows are bottom-up; a bitmap is upright.
    const msg: PreviewMsg = { t: 'frame', blob, w, h, at, seq, flip: !bmp };
    ch.postMessage(msg);
  } finally {
    busy = false;
  }
};
