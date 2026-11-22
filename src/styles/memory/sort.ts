/**
 * Back-to-front splat order: depth along the camera's forward axis,
 * quantised to 16 bits over the visible range, counting sort (two passes).
 * Splats behind the camera go first (they're culled in the vertex shader).
 */
const counts = new Uint32Array(65536);

export function sortSplats(pos: Float32Array, cam: readonly number[], fwd: readonly number[]): Uint32Array {
  const n = pos.length / 3;
  const keys = new Uint16Array(n);
  let lo = Infinity, hi = -Infinity;
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = (pos[i * 3] - cam[0]) * fwd[0] + (pos[i * 3 + 1] - cam[1]) * fwd[1] + (pos[i * 3 + 2] - cam[2]) * fwd[2];
    depth[i] = d;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const k = 65535 / Math.max(hi - lo, 1e-6);
  counts.fill(0);
  for (let i = 0; i < n; i++) {
    // far first: invert the key
    const key = 65535 - Math.floor((depth[i] - lo) * k);
    keys[i] = key;
    counts[key]++;
  }
  let sum = 0;
  for (let i = 0; i < 65536; i++) { const c = counts[i]; counts[i] = sum; sum += c; }
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[counts[keys[i]]++] = i;
  return out;
}
