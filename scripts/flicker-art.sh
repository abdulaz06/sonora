#!/usr/bin/env bash
# Flicker and exposure check: every kept look at default and Punchy
# responsiveness, on palette $1 (default 0 = Ocean). house-124 drop window.
pal=${1:-0}
for sv in ${LOOKS:-flow-ink:ink flow-ink:marble strands:silk strands:wisp strands:warp mosh:signal fractal:voyage}; do
  for r in 0.6 1; do
    node scripts/verify.mjs --flicker --style "${sv%%:*}" --variant "${sv##*:}" --palette "$pal" --resp $r --track house-124 2>&1 | grep -E "swings|rror"
  done
done
