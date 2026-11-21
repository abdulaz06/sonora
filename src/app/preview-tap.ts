/**
 * Controller preview: a small copy of exactly what the output shows, at
 * PREVIEW_FPS, without costing the output a frame (D83). Two techniques,
 * chosen by measurement (sprint log):
 *
 * - 'bitmap': right after a frame is drawn (the canvas still holds it),
 *   createImageBitmap snapshots and downscales it on the GPU, asynchronously;
 *   the bitmap is transferred to a worker that JPEG-encodes it and posts it
 *   on the preview channel. Nothing is read back on the output's thread.
 * - 'pbo': the picture is downscaled by halving blits and read into a
 *   pixel-pack buffer with readPixels (asynchronous); a fence marks the copy
 *   done and a later frame collects it once the fence has signalled (polled
 *   without blocking), from a recycled buffer pool, for the worker to encode.
 *
 * Neither ever does a synchronous GPU readback on the output's frame.
 */

import { wallMs } from './link';

// ── Tuning ──────────────────────────────────────────────────────
/** Preview frames per second (time-based, any display refresh). */
export const PREVIEW_FPS = 25;
/** Preview width (px); height follows the output's aspect. */
const PREVIEW_W = 512;
/** Readbacks in flight at once. */
const SLOTS = 3;
/** Most halving steps before the final blit (3840 → 480 needs 3). */
const MAX_HALVINGS = 3;

/** Bitmap snapshots in flight at once (more are skipped, never queued). */
const MAX_BITMAPS = 2;

export type TapMode = 'bitmap' | 'pbo';

interface Target { fb: WebGLFramebuffer; rb: WebGLRenderbuffer; w: number; h: number }
interface Slot { pbo: WebGLBuffer; fence: WebGLSync | null; at: number; w: number; h: number }

export interface PreviewStats {
  captures: number;
  sent: number;
  /** Mean CPU time of the hook on the output's frame (ms), last second. */
  hookMs: number;
  dropped: number;
}

export class PreviewTap {
  private readonly gl: WebGL2RenderingContext;
  private readonly worker: Worker;
  private chain: Target[] = [];
  private srcW = 0;
  private srcH = 0;
  private slots: Slot[] = [];
  private pool: ArrayBuffer[] = [];
  private active = false;
  private last = 0;
  private seq = 0;
  private hookAcc = 0;
  private hookN = 0;
  private hookT0 = 0;
  readonly stats: PreviewStats = { captures: 0, sent: 0, hookMs: 0, dropped: 0 };
  /** Harness only: capture every n-th frame regardless of time (0 = by time, PREVIEW_FPS). */
  forceEvery = 0;
  private frameN = 0;
  private bitmaps = 0;
  mode: TapMode;

  constructor(gl: WebGL2RenderingContext, mode: TapMode = 'bitmap') {
    this.gl = gl;
    this.mode = mode;
    this.worker = new Worker(new URL('./preview-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<{ buf: ArrayBuffer; sent: boolean }>) => { this.pool.push(e.data.buf); if (e.data.sent) this.stats.sent++; else this.stats.dropped++; };
    for (let i = 0; i < SLOTS; i++) this.slots.push({ pbo: gl.createBuffer()!, fence: null, at: 0, w: 0, h: 0 });
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.release();
  }
  isActive(): boolean { return this.active; }

  /** The renderer's frame hook: the canvas holds the frame just drawn. */
  onFrame(nowMs: number): void {
    if (!this.active) return;
    const t0 = performance.now();
    this.collect();
    this.frameN++;
    // Due times step by the interval (not from the last capture), so the
    // average stays PREVIEW_FPS at any refresh (a 165 Hz frame grid included).
    const iv = 1000 / PREVIEW_FPS;
    const due = this.forceEvery > 0 ? this.frameN % this.forceEvery === 0 : nowMs >= this.last;
    if (due && this.mode === 'bitmap') {
      if (this.bitmaps < MAX_BITMAPS) this.snapshot(); else this.stats.dropped++;
    } else if (due) {
      const slot = this.slots.find((s) => !s.fence);
      if (slot) this.capture(slot); else this.stats.dropped++;
    }
    if (due) {
      // `last` is the next due time; after a stall (or the first frame) it restarts from now.
      this.last += iv;
      if (this.last < nowMs - iv) this.last = nowMs + iv;
    }
    const t1 = performance.now();
    this.hookAcc += t1 - t0; this.hookN++;
    if (t1 - this.hookT0 > 1000) { this.stats.hookMs = this.hookAcc / Math.max(1, this.hookN); this.hookAcc = 0; this.hookN = 0; this.hookT0 = t1; }
  }

  private ensureChain(): void {
    const gl = this.gl;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (W === this.srcW && H === this.srcH && this.chain.length) return;
    this.release();
    for (const t of this.chain) { gl.deleteFramebuffer(t.fb); gl.deleteRenderbuffer(t.rb); }
    this.chain = [];
    this.srcW = W; this.srcH = H;
    const ow = Math.min(PREVIEW_W, W), oh = Math.max(1, Math.round((ow * H) / W));
    const sizes: [number, number][] = [];
    let w = W, h = H;
    while (sizes.length < MAX_HALVINGS && w / 2 >= ow * 1.5) { w = Math.round(w / 2); h = Math.round(h / 2); sizes.push([w, h]); }
    sizes.push([ow, oh]);
    for (const [tw, th] of sizes) {
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, tw, th);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      this.chain.push({ fb, rb, w: tw, h: th });
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bytes = ow * oh * 4;
    for (const s of this.slots) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ); }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.pool = [];
  }

  /** 'bitmap': a GPU-side snapshot of the canvas, downscaled, straight to the worker. */
  private snapshot(): void {
    const c = this.gl.canvas as HTMLCanvasElement;
    const W = c.width, H = c.height;
    const ow = Math.min(PREVIEW_W, W), oh = Math.max(1, Math.round((ow * H) / W));
    const at = wallMs(), seq = ++this.seq;
    this.bitmaps++;
    this.stats.captures++;
    createImageBitmap(c, { resizeWidth: ow, resizeHeight: oh, resizeQuality: 'medium' }).then((bmp) => {
      this.bitmaps--;
      this.worker.postMessage({ bmp, w: ow, h: oh, at, seq }, [bmp]);
      this.stats.sent++;
    }, () => { this.bitmaps--; this.stats.dropped++; });
  }

  private capture(slot: Slot): void {
    const gl = this.gl;
    this.ensureChain();
    // (The engine never enables the scissor test, so blits cover the whole target.)
    let sw = this.srcW, sh = this.srcH;
    let read: WebGLFramebuffer | null = null;   // the canvas
    for (const t of this.chain) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
      gl.blitFramebuffer(0, 0, sw, sh, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      read = t.fb; sw = t.w; sh = t.h;
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.at = wallMs(); slot.w = sw; slot.h = sh;
    this.stats.captures++;
  }

  /** Hand finished readbacks to the worker; never waits on the GPU. */
  private collect(): void {
    const gl = this.gl;
    for (const s of this.slots) {
      if (!s.fence) continue;
      // getSyncParameter is answered from state the browser updates between
      // tasks: polling it never waits on the GPU (clientWaitSync can).
      if (gl.getSyncParameter(s.fence, gl.SYNC_STATUS) !== gl.SIGNALED) continue;
      gl.deleteSync(s.fence);
      s.fence = null;
      const bytes = s.w * s.h * 4;
      let buf = this.pool.pop();
      if (!buf || buf.byteLength !== bytes) buf = new ArrayBuffer(bytes);
      const view = new Uint8Array(buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, view);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.worker.postMessage({ buf, w: s.w, h: s.h, at: s.at, seq: ++this.seq }, [buf]);
    }
  }

  private release(): void {
    for (const s of this.slots) if (s.fence) { this.gl.deleteSync(s.fence); s.fence = null; }
  }
}
