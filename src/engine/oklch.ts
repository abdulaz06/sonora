/**
 * OKLCH / OKLab (Björn Ottosson's perceptual colour space) to the sRGB
 * triples the shaders use, with gamut mapping by chroma reduction: an
 * out-of-gamut colour keeps its lightness and hue and loses only as much
 * chroma as needed (clipping channels would shift its hue and brightness).
 */

export type RGB3 = [number, number, number];
/** Lightness 0..1, chroma 0..~0.37, hue in degrees. */
export type OKLCH = [number, number, number];
export type OKLab = [number, number, number];

export function oklchToOklab([l, c, h]: OKLCH): OKLab {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

export function oklabToOklch([l, a, b]: OKLab): OKLCH {
  const c = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [l, c, h];
}

export function oklabToLinear([L, a, b]: OKLab): RGB3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function linearToOklab([r, g, b]: RGB3): OKLab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const encode = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decode = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

export function srgbToOklab(c: RGB3): OKLab {
  return linearToOklab([decode(c[0]), decode(c[1]), decode(c[2])]);
}

const inGamut = (c: RGB3): boolean => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH → sRGB (0..1), reducing chroma until the colour fits the gamut. */
export function oklchToSrgb(lch: OKLCH): RGB3 {
  const [l, c0, h] = lch;
  const L = Math.min(1, Math.max(0, l));
  let lin = oklabToLinear(oklchToOklab([L, c0, h]));
  if (!inGamut(lin)) {
    let lo = 0, hi = c0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(oklchToOklab([L, mid, h])))) lo = mid; else hi = mid;
    }
    lin = oklabToLinear(oklchToOklab([L, lo, h]));
  }
  return [encode(clamp01(lin[0])), encode(clamp01(lin[1])), encode(clamp01(lin[2]))];
}

/** Largest chroma that fits sRGB at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(oklchToOklab([l, mid, h])))) lo = mid; else hi = mid;
  }
  return lo;
}

/** Interpolate two sRGB colours through OKLab (no grey dip between hues). */
export function mixOklab(a: RGB3, b: RGB3, t: number): RGB3 {
  const A = srgbToOklab(a), B = srgbToOklab(b);
  const lin = oklabToLinear([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  return [encode(clamp01(lin[0])), encode(clamp01(lin[1])), encode(clamp01(lin[2]))];
}

/** Interpolate through OKLCH along the shorter hue arc (keeps chroma up). */
export function mixOklch(a: OKLCH, b: OKLCH, t: number): OKLCH {
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (((a[2] + dh * t) % 360) + 360) % 360];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
