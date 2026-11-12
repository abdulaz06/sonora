#!/usr/bin/env bash
# Synced frame cost per style at 1080p, Low and Medium (house-124 drop).
for sv in ink:glow ink:marble silk:silk wisp:wisp warp:warp voyage:voyage mosh:signal; do
  for q in low medium; do
    c=$(node scripts/verify.mjs --style "${sv%%:*}" --variant "${sv##*:}" --quality $q --track house-124 --out verify/perf/$q 2>&1 | grep "frame cost" | sed 's/.*: //')
    echo "$sv $q $c"
  done
done
