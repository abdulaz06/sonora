#!/usr/bin/env bash
# Flicker and exposure check: every kept look at default and Punchy
# responsiveness, on palette $1 (default 0 = Ocean). dense-128 drop window (TRACK= to change).
pal=${1:-0}
for sv in ${LOOKS:-ink:glow ink:marble silk:silk wisp:wisp warp:warp voyage:void voyage:city voyage:ocean}; do
  for r in 0.6 1; do
    node scripts/verify.mjs --flicker --style "${sv%%:*}" --variant "${sv##*:}" --palette "$pal" --resp $r --track ${TRACK:-dense-128} 2>&1 | grep -E "swings|rror"
  done
done
