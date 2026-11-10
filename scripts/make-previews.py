"""Convert harness screenshots into small style previews.

Usage: python scripts/make-previews.py [--track house-124]
Reads verify/<style>-<variant>-<view>/<track>/<frame>.png for each entry in
PICKS and writes src/assets/previews/<style>-<variant>.webp (480x270).
"""
import argparse
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# (style, variant, verify folder, frame)
PICKS = [
    ("flow-ink", "ink", "flow-ink-ink-depth", "4-drop"),
    ("flow-ink", "sumi", "flow-ink-sumi-depth", "3-build"),
    ("flow-ink", "marble", "flow-ink-marble-depth", "4-drop"),
    ("strands", "silk", "strands-silk-depth", "3-build"),
    ("strands", "lumen", "strands-lumen-depth", "4-drop"),
    ("strands", "wisp", "strands-wisp-depth", "3-build"),
    ("strands", "starry", "strands-starry-depth", "3-build"),
    ("strands", "warp", "strands-warp-depth", "3-build"),
    ("turing", "coral", "turing-coral-depth", "3-build"),
    ("turing", "bio", "turing-bio-depth", "3-build"),
    ("mosh", "concrete", "mosh-concrete-depth", "3-build"),
    ("mosh", "signal", "mosh-signal-depth", "3-build"),
    ("fractal", "voyage", "fractal-voyage-depth", "3-build"),
    ("fractal", "kaleido", "fractal-kaleido-depth", "4-drop"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", default="house-124")
    args = ap.parse_args()
    out_dir = os.path.join(ROOT, "src", "assets", "previews")
    os.makedirs(out_dir, exist_ok=True)
    missing = 0
    for style, variant, folder, frame in PICKS:
        src = os.path.join(ROOT, "verify", folder, args.track, frame + ".png")
        if not os.path.exists(src):
            print(f"missing {src}")
            missing += 1
            continue
        im = Image.open(src).convert("RGB")
        im.thumbnail((480, 270), Image.LANCZOS)
        dst = os.path.join(out_dir, f"{style}-{variant}.webp")
        im.save(dst, "WEBP", quality=82, method=6)
        print(f"{dst} {os.path.getsize(dst) // 1024} KB")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
