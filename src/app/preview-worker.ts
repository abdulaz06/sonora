/// <reference lib="webworker" />
/**
 * Preview encoder (runs off the output's main thread): raw RGBA from the
 * preview tap → JPEG → the preview channel. The pixel buffer goes straight
 * back to the tap's pool. Rows arrive bottom-up (readPixels); the controller
 * flips them when it draws.
 */

import { PREVIEW_CHANNEL, type PreviewMsg } from './link';

/** JPEG quality of preview frames. */
const QUALITY = 0.8;

const ch = new BroadcastChannel(PREVIEW_CHANNEL);
let canvas: OffscreenCanvas | null = null;
let g: OffscreenCanvasRenderingContext2D | null = null;
let busy = false;

self.onmessage = async (e: MessageEvent<{ buf: ArrayBuffer; w: number; h: number; at: number; seq: number }>) => {
  const { buf, w, h, at, seq } = e.data;
  // One frame in the encoder at a time: a newer frame supersedes a late one.
  if (busy) { (self as unknown as Worker).postMessage({ buf, sent: false }, [buf]); return; }
  busy = true;
  try {
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); g = canvas.getContext('2d'); }
    g!.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
    (self as unknown as Worker).postMessage({ buf, sent: true }, [buf]);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    const msg: PreviewMsg = { t: 'frame', blob, w, h, at, seq };
    ch.postMessage(msg);
  } finally {
    busy = false;
  }
};
