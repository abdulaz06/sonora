"""Ink smoothness metrics on frame sequences from scripts/frame-seq.mjs.

Usage:
  python scripts/ink-metrics.py pop  <frames_dir> [--json out.json]
  python scripts/ink-metrics.py jag  <frames_dir> [--every n]
  python scripts/ink-metrics.py motion <frames_dir>          # fine share at a fixed 1/60 s spacing
  python scripts/ink-metrics.py compare <dir_a> <dir_b>      # same passage, two render rates / builds

Each frames dir has a seq.json (render fps, viewport) written by frame-seq.mjs.

pop  "Spawn pop": how much ink appears from nowhere in 1/60 s. For each frame,
     a pixel is *unexplained* if its colour is far (> POP_TAU) from every
     pixel within POP_R (the distance the flow can carry ink in 1/60 s) of
     the frame 1/60 s earlier, even allowing that pixel to brighten or dim
     0.4-3.5x (a beat lighting existing ink is not a pop; a new hue, or ink
     landing on empty background, is). Thin unexplained edges (motion) are removed
     by a 3x3 opening; the rest is solid new ink. Score = peak unexplained
     area (% of the frame per 1/60 s); p99 also reported. The slow-motion
     evidence (DOCS/reference/ink-bugs) shows 0 → 4.3% of the frame in 21 ms.
jag  "Jaggedness": on strong edges, how far the local gradient direction
     strays from the edge's smoothed direction (structure tensor, 4 px).
     A smooth curve scores ~0; saw-tooth / stair-step edges score high.
     Reported as the gradient-weighted mean |sin| of the misalignment (%),
     after a 1.2 px pre-blur so 1-pixel dither does not count. Also reports
     the frame-to-frame change of that edge field (crawl).
motion  Large vs fine change (as scripts/motion-check.py) between frames
     1/60 s apart, so sequences rendered at any rate compare directly.
compare  Mean absolute difference of the blurred (large-shape) picture at
     the same audio times, plus pop / motion side by side.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

POP_TAU = 0.16       # colour distance (0-1 RGB, Euclidean) that counts as new ink
POP_R_480 = 3        # flow carry tolerance in pixels at 480 px wide, per 1/60 s
POP_GAIN = (0.4, 3.5)  # per-pixel brightness change that still counts as the same ink
JAG_PRE = 1.2        # pre-blur sigma (px at 1280 wide)
JAG_INT = 4.0        # structure-tensor integration sigma (px at 1280 wide)
JAG_EDGE_PCT = 92    # strong edges: gradient magnitude above this percentile


def seq_info(d):
    p = os.path.join(d, 'seq.json')
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return {'fps': 60}


def frame_paths(d):
    return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.png')]


def load_rgb(p, width=None):
    im = Image.open(p).convert('RGB')
    if width and im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32) / 255.0


def gauss1d(sigma):
    r = max(1, int(np.ceil(sigma * 3)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-x * x / (2 * sigma * sigma))
    return k / k.sum()


def blur(a, sigma):
    k = gauss1d(sigma)
    r = len(k) // 2
    p = np.pad(a, ((r, r), (0, 0)) + ((0, 0),) * (a.ndim - 2), mode='edge')
    out = sum(k[i] * p[i:i + a.shape[0]] for i in range(len(k)))
    p = np.pad(out, ((0, 0), (r, r)) + ((0, 0),) * (a.ndim - 2), mode='edge')
    return sum(k[i] * p[:, i:i + a.shape[1]] for i in range(len(k)))


def shifted(a, dy, dx):
    h, w = a.shape[:2]
    p = np.pad(a, ((abs(dy), abs(dy)), (abs(dx), abs(dx))) + ((0, 0),) * (a.ndim - 2), mode='edge')
    return p[abs(dy) + dy:abs(dy) + dy + h, abs(dx) + dx:abs(dx) + dx + w]


def opening3(m):
    er = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            er &= shifted(m, dy, dx)
    di = er.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            di |= shifted(er, dy, dx)
    return di


def lag_frames(fps):
    """Frames spanning ~1/60 s, and the real time they span."""
    k = max(1, int(round(fps / 60)))
    return k, k / fps


# ── Pop ─────────────────────────────────────────────────────────
def pop(d, width=480):
    info = seq_info(d)
    fps = info.get('fps', 60)
    k, span = lag_frames(fps)
    paths = frame_paths(d)
    frames = [load_rgb(p, width) for p in paths]
    r = max(1, int(round(POP_R_480 * width / 480 * (span * 60))))
    offs = [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dy * dy + dx * dx <= r * r + 0.5]
    areas = []
    for i in range(k, len(frames)):
        cur, prev = frames[i], frames[i - k]
        cc = (cur * cur).sum(2)
        best = np.full(cur.shape[:2], np.inf, dtype=np.float32)
        for dy, dx in offs:
            s = shifted(prev, dy, dx)
            dot = (cur * s).sum(2)
            pp = (s * s).sum(2)
            # Best per-pixel brightness gain within POP_GAIN: existing ink that
            # brightens or dims (beat light) is explained; a new hue, or ink on
            # an empty background, is not.
            gain = np.clip(dot / (pp + 1e-6), POP_GAIN[0], POP_GAIN[1])
            res = np.sqrt(np.maximum(cc - 2 * gain * dot + gain * gain * pp, 0))
            best = np.minimum(best, res)
        m = opening3(best > POP_TAU)
        # Normalise to "per 1/60 s" (165 fps compares frames 18.2 ms apart).
        areas.append(float(m.mean()) * 100 * (1 / 60) / span)
    a = np.array(areas) if areas else np.zeros(1)
    return {'pop_peak': float(a.max()), 'pop_p99': float(np.percentile(a, 99)), 'pop_mean': float(a.mean()),
            'pop_series': [round(x, 3) for x in a.tolist()], 'fps': fps, 'lag_frames': k}


# ── Jaggedness ──────────────────────────────────────────────────
def jag_frame(g, scale):
    g = blur(g, JAG_PRE * scale)
    gx = (shifted(g, 0, -1) - shifted(g, 0, 1)) * 0.5
    gy = (shifted(g, -1, 0) - shifted(g, 1, 0)) * 0.5
    mag = np.sqrt(gx * gx + gy * gy)
    jxx, jyy, jxy = blur(gx * gx, JAG_INT * scale), blur(gy * gy, JAG_INT * scale), blur(gx * gy, JAG_INT * scale)
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy)        # dominant gradient direction
    nx, ny = np.cos(theta), np.sin(theta)
    cross = np.abs(gx * ny - gy * nx)                    # |gradient × smoothed normal| = |g|·|sin|
    thr = np.percentile(mag, JAG_EDGE_PCT)
    sel = mag > max(thr, 0.004)
    if sel.sum() < 50:
        return 0.0, sel
    return float(cross[sel].sum() / mag[sel].sum()), sel


def jag(d, every=1, width=1280):
    paths = frame_paths(d)[::every]
    vals, crawl = [], []
    prev = None
    for p in paths:
        im = load_rgb(p, width)
        g = im @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        v, sel = jag_frame(g, width / 1280)
        vals.append(v)
        if prev is not None:
            crawl.append(float((sel ^ prev).mean() / max(sel.mean(), 1e-6)))
        prev = sel
    a = np.array(vals)
    return {'jag_mean': float(a.mean()) * 100, 'jag_p90': float(np.percentile(a, 90)) * 100,
            'edge_crawl': float(np.median(crawl)) * 100 if crawl else 0.0, 'frames': len(vals)}


# ── Motion at a fixed 1/60 s spacing ───────────────────────────
def motion(d):
    info = seq_info(d)
    k, _ = lag_frames(info.get('fps', 60))
    paths = frame_paths(d)
    large, fine = [], []
    prev = None
    for p in paths[::k]:
        g = load_rgb(p, 480).mean(2)
        gb = blur(g, 6)
        if prev is not None:
            pg, pb = prev
            m = max(float(pg.mean()), 0.02)
            large.append(np.abs(gb - pb).mean() / m)
            fine.append(np.abs((g - gb) - (pg - pb)).mean() / m)
        prev = (g, gb)
    L, F = float(np.median(large)) * 100, float(np.median(fine)) * 100
    return {'large': L, 'fine': F, 'fine_share': F / max(L + F, 1e-6) * 100}


def compare(a, b):
    ia, ib = seq_info(a), seq_info(b)
    pa, pb = frame_paths(a), frame_paths(b)
    fa, fb = ia.get('fps', 60) / ia.get('step', 1), ib.get('fps', 60) / ib.get('step', 1)
    # Common times: frames whose times coincide (within 0.5 ms).
    diffs = []
    t = 0.0
    n = 0
    while True:
        i, j = t * fa, t * fb
        if abs(i - round(i)) < 0.03 and abs(j - round(j)) < 0.03:
            i, j = int(round(i)), int(round(j))
            if i >= len(pa) or j >= len(pb):
                break
            ga = blur(load_rgb(pa[i], 480).mean(2), 6)
            gb = blur(load_rgb(pb[j], 480).mean(2), 6)
            diffs.append(float(np.abs(ga - gb).mean() / max(ga.mean(), 0.02)) * 100)
            n += 1
        t += 1 / 60
        if t * fa > len(pa) or t * fb > len(pb):
            break
    return {'common_frames': n, 'large_diff_mean': float(np.mean(diffs)) if diffs else None,
            'large_diff_max': float(np.max(diffs)) if diffs else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['pop', 'jag', 'motion', 'compare'])
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--every', type=int, default=1)
    ap.add_argument('--json')
    a = ap.parse_args()
    if a.cmd == 'pop':
        r = pop(a.dirs[0])
        print(f"{os.path.basename(a.dirs[0].rstrip('/'))}: pop peak {r['pop_peak']:.2f}%/frame60  p99 {r['pop_p99']:.2f}  mean {r['pop_mean']:.3f}  ({r['fps']} fps, lag {r['lag_frames']})")
    elif a.cmd == 'jag':
        r = jag(a.dirs[0], a.every)
        print(f"{os.path.basename(a.dirs[0].rstrip('/'))}: jag {r['jag_mean']:.2f}% (p90 {r['jag_p90']:.2f})  edge crawl {r['edge_crawl']:.1f}%  [{r['frames']} frames]")
    elif a.cmd == 'motion':
        r = motion(a.dirs[0])
        print(f"{os.path.basename(a.dirs[0].rstrip('/'))}: large {r['large']:.2f}%  fine {r['fine']:.2f}%  fine share {r['fine_share']:.0f}%")
    else:
        r = compare(a.dirs[0], a.dirs[1])
        print(f"compare: {r['common_frames']} common frames, large-shape diff mean {r['large_diff_mean']:.2f}% max {r['large_diff_max']:.2f}%")
    if a.json:
        with open(a.json, 'w') as f:
            json.dump(r, f, indent=1)


if __name__ == '__main__':
    main()
