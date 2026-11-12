#!/usr/bin/env bash
# Render every art style/look on the given tracks (default: all).
# One harness at a time; screenshots land in verify/<style>-<look>-…/.
tracks=${1:-all}
for sv in ink:glow ink:marble ink:sumi silk:silk wisp:wisp warp:warp voyage:voyage mosh:signal; do
  node scripts/verify.mjs --style "${sv%%:*}" --variant "${sv##*:}" --track "$tracks" --no-bench 2>&1 | grep -E "^[a-z0-9-]+:|events|rror"
done
