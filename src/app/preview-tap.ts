/**
 * Controller preview: a small copy of exactly what the output shows, at
 * PREVIEW_FPS, without costing the output a frame (D83).
 *
 * Right after a frame is drawn (the canvas still holds it), the picture is
 * downscaled on the GPU by halving blits and read into a pixel-pack buffer
 * with readPixels — asynchronous: nothing waits for the GPU. A fence marks
 * when the copy is done; a later frame picks the pixels up only once the
 * fence has signalled (never a synchronous readback on the output's frame).
 * The pixels go to a worker that JPEG-encodes them and posts them on the
 * preview channel; the buffers come back to a small pool (no garbage on the
 * output's thread).
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

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
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
    const due = this.forceEvery > 0 ? this.frameN % this.forceEvery === 0 : nowMs - this.last >= 1000 / PREVIEW_FPS - 2;
    if (due) {
      const slot = this.slots.find((s) => !s.fence);
      if (slot) { this.capture(slot); this.last = nowMs; } else this.stats.dropped++;
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

  private capture(slot: Slot): void {
    const gl = this.gl;
    this.ensureChain();
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
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
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.at = wallMs(); slot.w = sw; slot.h = sh;
    this.stats.captures++;
  }

  /** Hand finished readbacks to the worker; never waits on the GPU. */
  private collect(): void {
    const gl = this.gl;
    for (const s of this.slots) {
      if (!s.fence) continue;
      const st = gl.clientWaitSync(s.fence, 0, 0);
      if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) continue;
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
