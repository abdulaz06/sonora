#!/usr/bin/env bash
# Every gate for every art style / look / view, one log (generalises ink-gates.sh):
#   sync     house-124 and the private ref-song (if present), whole-screen + regional
#   flicker  dense-128 drop window at Punchy (resp 1)
#   motion   6 s sequences (480x270): fine share ≤45%, background step ≤0.02
#   cost     synced frame cost, Medium, 1080p (house-124 drop)
# Usage: scripts/style-gates.sh <outDir>
# Env: PALETTE (index, default 0), TRACKS (sync tracks), ONLY="sync flicker motion cost", COMBOS="ink:glow:flat voyage:void:flat …",
#      SEQ_ROOT (motion frames, deleted after measuring; default the OS temp dir).
out=${1:-verify/style-gates}
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
log="$out/gates.log"
: > "$log"
pal=${PALETTE:-0}
only=${ONLY:-sync flicker motion cost}
combos=${COMBOS:-"ink:glow:flat ink:glow:depth ink:marble:flat ink:marble:depth ink:sumi:flat ink:sumi:depth silk:silk:flat silk:silk:depth wisp:ground:flat wisp:ground:depth wisp:tunnel:depth warp:warp:flat voyage:void:flat voyage:city:flat voyage:ocean:flat"}
seqroot=${SEQ_ROOT:-${TMPDIR:-/tmp}/sonora-gates-seq}
tracks="house-124"
[ -f test-audio/local/ref-song.wav ] && tracks="$tracks ref-song"
[ -n "$TRACKS" ] && tracks="$TRACKS"
for c in $combos; do
  IFS=: read -r style look view <<< "$c"
  tag="$style $look $view"
  vf=""; [ "$view" = flat ] && vf="--flat"
  if [[ " $only " == *" sync "* ]]; then
    for tr in $tracks; do
      node scripts/verify.mjs --sync --style $style --variant $look $vf --palette $pal --track $tr 2>&1 | grep -E "kicks|rror" | sed "s/^/SYNC $tag /" | tee -a "$log"
    done
  fi
  if [[ " $only " == *" flicker "* ]]; then
    node scripts/verify.mjs --flicker --style $style --variant $look $vf --palette $pal --resp 1 --track dense-128 2>&1 | grep -E "swings|FLICKER|flicker|rror" | sed "s/^/FLICKER $tag /" | tee -a "$log"
  fi
  if [[ " $only " == *" motion "* ]]; then
    for spec in "house-124 48" "ref-song 18"; do
      set -- $spec
      [ "$1" = ref-song ] && [ ! -f test-audio/local/ref-song.wav ] && continue
      d="$seqroot/$style-$look-$view-$1"
      rm -rf "$d"
      SEQ_PALETTE=$pal SEQ_W=480 SEQ_H=270 node "$here/frame-seq.mjs" $style $look $1 $2 6 $view 1 "$d" > /dev/null 2>&1
      python "$here/motion-check.py" "$d" 2>&1 | sed "s/^/MOTION $tag $1 /" | tee -a "$log"
      rm -rf "$d"
    done
  fi
  if [[ " $only " == *" cost "* ]]; then
    # --out is relative to the repo (verify joins it onto the root).
    for q in ${QUALITIES:-medium}; do
      node scripts/verify.mjs --style $style --variant $look $vf --palette $pal --quality $q --track house-124 --out "verify/tmp-cost/$style-$look-$view-$q" 2>&1 | grep -E "frame cost|fps:" | sed "s/^/COST $tag $q /" | tee -a "$log"
      rm -rf "verify/tmp-cost/$style-$look-$view-$q"
    done
  fi
done
