#!/usr/bin/env bash
# Every Ink gate for Glow / Marble / Sumi × Flat / Depth, one log:
#   sync     house-124 and the private ref-song (if present), whole-screen + regional
#   flicker  dense-128 drop window at Punchy (resp 1), palette 0 (Ocean)
#   motion   6 s sequences (480x270): fine share ≤45%, background step ≤0.02
#   cost     synced frame cost, Medium, 1080p (house-124 drop)
# Usage: scripts/ink-gates.sh <outDir> [extra verify/frame-seq env, e.g. SEQ_DEBUG]
# Run from any checkout (a baseline worktree renders the baseline). Extra
# verify flags: VERIFY_ARGS="--fps 165" etc. ONLY="sync flicker motion cost" picks parts.
out=${1:-verify/ink-gates}
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
log="$out/gates.log"
: > "$log"
only=${ONLY:-sync flicker motion cost}
looks=${LOOKS:-glow marble sumi}
views=${VIEWS:-flat depth}
tracks="house-124"
[ -f test-audio/local/ref-song.wav ] && tracks="$tracks ref-song"
for look in $looks; do
  for view in $views; do
    vf=""; [ "$view" = flat ] && vf="--flat"
    if [[ " $only " == *" sync "* ]]; then
      for tr in $tracks; do
        node scripts/verify.mjs --sync --style ink --variant $look $vf --track $tr $VERIFY_ARGS 2>&1 | grep -E "kicks|rror" | sed "s/^/SYNC $look $view /" | tee -a "$log"
      done
    fi
    if [[ " $only " == *" flicker "* ]]; then
      node scripts/verify.mjs --flicker --style ink --variant $look $vf --palette 0 --resp 1 --track dense-128 $VERIFY_ARGS 2>&1 | grep -E "swings|FLICKER|flicker|rror" | sed "s/^/FLICKER $look $view /" | tee -a "$log"
    fi
    if [[ " $only " == *" motion "* ]]; then
      for spec in "house-124 48" "ref-song 18"; do
        set -- $spec
        [ "$1" = ref-song ] && [ ! -f test-audio/local/ref-song.wav ] && continue
        d="$out/seq/$look-$view-$1"
        SEQ_W=480 SEQ_H=270 node "$here/frame-seq.mjs" ink $look $1 $2 6 $view 1 "$d" > /dev/null 2>&1
        python "$here/motion-check.py" "$d" 2>&1 | sed "s/^/MOTION $look $view $1 /" | tee -a "$log"
      done
    fi
    if [[ " $only " == *" cost "* ]]; then
      node scripts/verify.mjs --style ink --variant $look $vf --track house-124 --out "verify/ink-gates-cost/$look-$view" $VERIFY_ARGS 2>&1 | grep -E "frame cost|fps:" | sed "s/^/COST $look $view /" | tee -a "$log"
    fi
  done
done
