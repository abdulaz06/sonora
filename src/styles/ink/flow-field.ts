/**
 * CPU copy of Ink's curl-noise velocity (sim.glsl `flowVel`, common.glsl
 * `pnoise`), so ink that is still landing can be carried with the flow the
 * GPU applies to the ink already on screen. Same hash, same quintic fade,
 * same periodic lattice; evaluated at a handful of points per frame.
 */

/** pcg3d on uint32 (common.glsl). */
function pcg3d(x: number, y: number, z: number, out: Uint32Array): void {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  out[0] = x; out[1] = y; out[2] = z;
}

const h = new Uint32Array(3);
const glslMod = (a: number, b: number): number => a - b * Math.floor(a / b);

/** Gradient noise, periodic in x/y with integer periods, free in z (≈[-1, 1]). */
export function pnoise(px: number, py: number, pz: number, perX: number, perY: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const q = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const ux = q(fx), uy = q(fy), uz = q(fz);
  const n = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 8; k++) {
    const ox = k & 1, oy = (k >> 1) & 1, oz = (k >> 2) & 1;
    const cx = glslMod(ix + ox, perX), cy = glslMod(iy + oy, perY), cz = iz + oz;
    pcg3d((Math.trunc(cx) + 65536) >>> 0, (Math.trunc(cy) + 65536) >>> 0, (Math.trunc(cz) + 65536) >>> 0, h);
    const gx = (h[0] & 0xffff) / 32767.5 - 1, gy = (h[1] & 0xffff) / 32767.5 - 1, gz = (h[2] & 0xffff) / 32767.5 - 1;
    n[k] = gx * (fx - ox) + gy * (fy - oy) + gz * (fz - oz);
  }
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = mix(n[0], n[1], ux), x10 = mix(n[2], n[3], ux);
  const x01 = mix(n[4], n[5], ux), x11 = mix(n[6], n[7], ux);
  return mix(mix(x00, x10, uy), mix(x01, x11, uy), uz) * 1.6;
}

/** Curl of the noise potential (sim.glsl `curlAt`). */
function curlAt(qx: number, qy: number, z: number, perX: number, perY: number, out: [number, number]): void {
  const e = 0.05;
  const n1 = pnoise(qx, qy + e, z, perX, perY), n2 = pnoise(qx, qy - e, z, perX, perY);
  const n3 = pnoise(qx + e, qy, z, perX, perY), n4 = pnoise(qx - e, qy, z, perX, perY);
  out[0] = (n1 - n2) / (2 * e);
  out[1] = -(n3 - n4) / (2 * e);
}

export interface FlowFieldParams {
  period: [number, number, number, number];
  detail: number;
  offset: [number, number];
  z: number;
  /** Domain uv per second per unit of curl. */
  speed: number;
}

const tmp: [number, number] = [0, 0];

/** Flow velocity at domain uv (x, y), in domain uv per second. */
export function flowVelocity(x: number, y: number, p: FlowFieldParams, out: [number, number]): [number, number] {
  const u = ((x % 1) + 1) % 1, v = ((y % 1) + 1) % 1;
  curlAt(u * p.period[0] + p.offset[0], v * p.period[1] + p.offset[1], p.z, p.period[0], p.period[1], out);
  if (p.detail !== 0) {
    curlAt(u * p.period[2] + p.offset[0] * 1.8, v * p.period[3] + p.offset[1] * 1.8, p.z * 1.4 + 7, p.period[2], p.period[3], tmp);
    out[0] += p.detail * tmp[0];
    out[1] += p.detail * tmp[1];
  }
  out[0] *= p.speed;
  out[1] *= p.speed;
  return out;
}
