/**
 * Flow field — a 2D vector field driven by layered simplex noise.
 * Used by tendrils and particles to follow organic curved paths.
 * The field slowly evolves over time for generative variation.
 */

import { simplex3 } from '../engine/noise';

const FIELD_RES = 32; // 32x32 grid of vectors

export class FlowField {
  /** Direction vectors as angles in radians. */
  private angles: Float32Array;
  private scale = 2.5;    // Noise sampling scale
  private timeScale = 0.08; // How fast the field evolves

  constructor() {
    this.angles = new Float32Array(FIELD_RES * FIELD_RES);
  }

  /** Update the flow field. Call once per frame. */
  update(time: number, energy: number): void {
    const t = time * this.timeScale;
    // Energy makes the field more turbulent (higher frequency)
    const s = this.scale + energy * 1.5;

    for (let y = 0; y < FIELD_RES; y++) {
      for (let x = 0; x < FIELD_RES; x++) {
        const nx = (x / FIELD_RES) * s;
        const ny = (y / FIELD_RES) * s;
        // Use 3D noise with time as Z for smooth evolution
        this.angles[y * FIELD_RES + x] = simplex3(nx, ny, t) * Math.PI * 2;
      }
    }
  }

  /** Sample the flow field direction at a normalized position (-1..1, -1..1).
   *  Returns [dx, dy] unit vector. */
  sample(x: number, y: number): [number, number] {
    // Map -1..1 to 0..FIELD_RES
    const gx = ((x + 1) * 0.5) * (FIELD_RES - 1);
    const gy = ((y + 1) * 0.5) * (FIELD_RES - 1);

    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;

    // Bilinear interpolation of angles
    const i00 = this.getAngle(ix, iy);
    const i10 = this.getAngle(ix + 1, iy);
    const i01 = this.getAngle(ix, iy + 1);
    const i11 = this.getAngle(ix + 1, iy + 1);

    // Interpolate using sin/cos to handle angle wrapping
    const cx = Math.cos(i00) * (1-fx)*(1-fy) + Math.cos(i10) * fx*(1-fy) +
               Math.cos(i01) * (1-fx)*fy + Math.cos(i11) * fx*fy;
    const cy = Math.sin(i00) * (1-fx)*(1-fy) + Math.sin(i10) * fx*(1-fy) +
               Math.sin(i01) * (1-fx)*fy + Math.sin(i11) * fx*fy;

    const len = Math.sqrt(cx * cx + cy * cy) || 1;
    return [cx / len, cy / len];
  }

  private getAngle(x: number, y: number): number {
    const cx = Math.max(0, Math.min(FIELD_RES - 1, x));
    const cy = Math.max(0, Math.min(FIELD_RES - 1, y));
    return this.angles[cy * FIELD_RES + cx];
  }
}
