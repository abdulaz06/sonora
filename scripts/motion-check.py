"""Motion character and per-region flicker of a frame sequence.

Usage:
  python scripts/motion-check.py <frames_dir> [--fps 60] [--start s] [--seconds s]
                                 [--ref <frames_dir> --ref-offset s] [--paper]

Frames come from scripts/frame-seq.mjs (harness renders) or ffmpeg (screen
recordings). Measures, on 480x270 greyscale:
  large   change of the large shapes between consecutive frames (blurred), % of mean
  fine    change of the fine detail (flecks, streaks, texture), % of mean
  fine share = fine / (large + fine). v0.1 Flow Ink: ~34%. Busy shimmer that
          drowns the hits shows up as a high fine share.
  calm    25th percentile of total change (how still the calm moments are)
  background  frame-to-frame change of the background level (the night, or
          the paper on Sumi / light looks). Ink may glow and move; the
          background may not pulse. Reports the 99th percentile step.
Prints PASS/FAIL against the gates below. Never report a style as done
without a PASS here (see DOCS/16 Quality Bar).
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

# ── Gates ───────────────────────────────────────────────────────
FINE_SHARE_MAX = 0.45      # v0.1 reference ≈ 0.34; round-6 Ink was 0.73
BG_STEP_MAX = 0.01         # background (night / paper) may not jump more than 1% of full scale in a frame
                           # (v0.1 ≈ 0.001; round-6 Sumi's paper jumped 0.14 on every kick)
GRID = (8, 5)

ap = argparse.ArgumentParser()
ap.add_argument('frames')
ap.add_argument('--fps', type=float, default=60)
ap.add_argument('--start', type=float, default=0)
ap.add_argument('--seconds', type=float, default=1e9)
ap.add_argument('--ref')
ap.add_argument('--ref-offset', type=float, default=0)
args = ap.parse_args()


def frames(d, start, seconds, fps):
    fs = sorted(f for f in os.listdir(d) if f.endswith('.png'))
    a = int(round(start * fps))
    b = min(len(fs), a + int(round(seconds * fps)))
    return [os.path.join(d, f) for f in fs[a:b]]


def load(p):
    im = Image.open(p).convert('L').resize((480, 270), Image.BILINEAR)
    g = np.asarray(im, dtype=np.float32) / 255.0
    gb = np.asarray(im.filter(ImageFilter.GaussianBlur(6)), dtype=np.float32) / 255.0
    return g, gb


def background(g, paper):
    """Background level: the brightest 40% on paper looks, the darkest 40% at night."""
    if paper:
        return float(g[g >= np.percentile(g, 60)].mean())
    return float(g[g <= np.percentile(g, 40)].mean())


def measure(paths, fps):
    large, fine, total, bg = [], [], [], []
    prev = None
    paper = np.median([load(p)[0].mean() for p in paths[::max(1, len(paths) // 12)]]) > 0.45
    for p in paths:
        g, gb = load(p)
        bg.append(background(g, paper))
        if prev is not None:
            pg, pb = prev
            m = max(float(pg.mean()), 0.02)
            dl = np.abs(gb - pb).mean() / m
            dh = np.abs((g - gb) - (pg - pb)).mean() / m
            large.append(dl); fine.append(dh); total.append(np.abs(g - pg).mean() / m)
        prev = (g, gb)
    steps = np.abs(np.diff(np.array(bg)))
    return {
        'large': float(np.median(large)) * 100, 'fine': float(np.median(fine)) * 100,
        'calm': float(np.percentile(total, 25)) * 100,
        'bg_p99': float(np.percentile(steps, 99)), 'bg_max': float(steps.max()),
    }


def report(name, r):
    share = r['fine'] / max(r['large'] + r['fine'], 1e-6)
    ok_m = share <= FINE_SHARE_MAX
    ok_f = r['bg_p99'] <= BG_STEP_MAX
    print(f"{name}: large {r['large']:.2f}%  fine {r['fine']:.2f}%  fine share {share * 100:.0f}% [{'PASS' if ok_m else 'FAIL'} <= {FINE_SHARE_MAX * 100:.0f}%]"
          f"  calm {r['calm']:.2f}%  background step p99 {r['bg_p99']:.4f} max {r['bg_max']:.4f} [{'PASS' if ok_f else 'FAIL'} <= {BG_STEP_MAX}]")
    return ok_m and ok_f


ok = report(os.path.basename(args.frames.rstrip('/\\')), measure(frames(args.frames, args.start, args.seconds, args.fps), args.fps))
if args.ref:
    report('reference ' + os.path.basename(args.ref.rstrip('/\\')),
           measure(frames(args.ref, args.start + args.ref_offset, args.seconds, args.fps), args.fps))
sys.exit(0 if ok else 1)
