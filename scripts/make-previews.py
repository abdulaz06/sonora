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
    ("ink", "glow", "ink-glow", "4-drop"),
    ("ink", "marble", "ink-marble", "4-drop"),
    ("ink", "sumi", "ink-sumi", "3-build"),
    ("silk", "silk", "silk", "3-build"),
    ("wisp", "wisp", "wisp", "3-build"),
    ("warp", "warp", "warp", "3-build"),
    ("voyage", "voyage", "voyage", "3-build"),
    ("mosh", "signal", "mosh-signal", "3-build"),
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
