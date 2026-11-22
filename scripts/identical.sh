#!/usr/bin/env bash
# Pixel comparison against a baseline checkout: the same frame sequences
# rendered by both (frame-seq.mjs, fixed step), compared frame by frame.
#   scripts/identical.sh <baseline checkout> [out.log]
# Env: COMBOS ("style:look:view" list), TRACK (house-124), START (48), SECS (2), ROOT (scratch dir)
base=${1:?baseline checkout}
log=${2:-verify/identical.log}
combos=${COMBOS:-"ink:glow:depth ink:marble:depth ink:sumi:flat silk:-:depth wisp:tunnel:depth warp:-:flat"}
root=${ROOT:-$HOME/sonora-identical}
here=$(pwd)
mkdir -p "$(dirname "$log")"; : > "$log"
for c in $combos; do
  IFS=: read -r style look view <<< "$c"
  a="$root/base-$style-$look-$view"; b="$root/new-$style-$look-$view"
  rm -rf "$a" "$b"
  (cd "$base" && SEQ_W=480 SEQ_H=270 node scripts/frame-seq.mjs "$style" "$look" "${TRACK:-house-124}" "${START:-48}" "${SECS:-2}" "$view" 1 "$a" > /dev/null 2>&1)
  (cd "$here" && SEQ_W=480 SEQ_H=270 node scripts/frame-seq.mjs "$style" "$look" "${TRACK:-house-124}" "${START:-48}" "${SECS:-2}" "$view" 1 "$b" > /dev/null 2>&1)
  python -I - "$a" "$b" "$style-$look-$view" <<'PY' | tee -a "$log"
import sys, os
import numpy as np
from PIL import Image
a, b, name = sys.argv[1:4]
fa = sorted(f for f in os.listdir(a) if f.endswith('.png')) if os.path.isdir(a) else []
same = 0; mx = 0
for f in fa:
    pb = os.path.join(b, f)
    if not os.path.exists(pb): continue
    x = np.asarray(Image.open(os.path.join(a, f)).convert('RGB'), dtype=np.int16)
    y = np.asarray(Image.open(pb).convert('RGB'), dtype=np.int16)
    d = int(np.abs(x - y).max()); mx = max(mx, d); same += d == 0
print(f"{name:24s} frames {len(fa)}: identical {same}/{len(fa)}, max diff {mx}/255")
PY
  rm -rf "$a" "$b"
done
