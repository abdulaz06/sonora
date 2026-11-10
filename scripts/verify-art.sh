#!/usr/bin/env bash
# Render every art-style variant on the given tracks (default: all four).
# One harness at a time; screenshots land in verify/<style>-<variant>-…/.
tracks=${1:-all}
for sv in strands:silk strands:lumen strands:wisp strands:starry strands:warp \
          turing:coral turing:bio mosh:concrete mosh:signal fractal:voyage fractal:kaleido; do
  node scripts/verify.mjs --style "${sv%%:*}" --variant "${sv##*:}" --track "$tracks" --no-bench 2>&1 | grep -E "^[a-z0-9-]+:|events|rror"
done
