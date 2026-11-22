#!/usr/bin/env bash
# 1.2 gate batches (one log per batch in verify/gates-1.2/):
#   filters   Glyph and Reeded glass over every art style's default look: sync (house-124),
#             flicker (dense-128 at Punchy), frame cost (1080p Medium, with vs without)
#   motion    6 s sequences (480x270) on house-124 and the private ref-song: fine share, background step
#   dt        frame-rate independence (60 / 120 / 165 fps) per new style
#   syncflicker  sync (house-124) and flicker (dense-128 at Punchy) for every new combo
#   compile   cold first-use cost (shader compile) per new combo
# Usage: bash scripts/gates-12.sh filters|motion|dt|syncflicker|compile
# Env: SONORA_HARNESS_PORT / SONORA_VITE_CACHE (own port), SEQ_ROOT (scratch for frames).
set -u
batch=${1:-filters}
out=verify/gates-1.2
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
seqroot=${SEQ_ROOT:-${TMPDIR:-/tmp}/sonora-12-seq}
# style:look:view
DEFAULTS="ink:glow:depth silk:silk:flat wisp:ground:flat warp:warp:flat voyage:void:flat stage:club:flat cymatics:stone:flat glass:bubbles:flat cover:cover:flat echo:glow:flat memory:forest:flat"
NEW="silk:helix:flat silk:helix:depth stage:club:flat stage:arena:flat stage:cathedral:flat cymatics:stone:flat cymatics:sand:flat cymatics:liquid:flat glass:bubbles:flat glass:fins:flat glass:chrome:flat cover:cover:flat echo:glow:flat echo:trace:flat memory:forest:flat memory:coast:flat memory:desert:flat"

if [ "$batch" = filters ]; then
  log="$out/filters.log"; : > "$log"
  for f in glyph reeded; do
    for c in $DEFAULTS; do
      IFS=: read -r style look view <<< "$c"
      vf=""; [ "$view" = flat ] && vf="--flat"
      tag="$f $style $look $view"
      SONORA_FILTER=$f node scripts/verify.mjs --sync --style $style --variant $look $vf --track house-124 2>&1 | grep -E "kicks|rror" | sed "s/^/SYNC $tag /" | tee -a "$log"
      SONORA_FILTER=$f node scripts/verify.mjs --flicker --style $style --variant $look $vf --resp 1 --track dense-128 2>&1 | grep -E "swings|PASS|FAIL|rror" | sed "s/^/FLICKER $tag /" | tee -a "$log"
    done
  done
  if [ -z "${NOCOST:-}" ]; then
    combos=""
    for c in $DEFAULTS; do combos="$combos $c $c:glyph $c:reeded"; done
    node scripts/cost.mjs $combos --q medium --rounds 2 2>&1 | grep -E "COST|exception" | tee -a "$log"
  fi
fi

if [ "$batch" = motion ]; then
  log="$out/motion.log"; : > "$log"
  for c in $NEW; do
    IFS=: read -r style look view <<< "$c"
    for spec in "house-124 48" "ref-song 18"; do
      set -- $spec
      [ "$1" = ref-song ] && [ ! -f test-audio/local/ref-song.wav ] && continue
      d="$seqroot/$style-$look-$view-$1"
      rm -rf "$d"
      SEQ_W=480 SEQ_H=270 node "$here/frame-seq.mjs" $style $look $1 $2 6 $view 1 "$d" > /dev/null 2>&1
      python "$here/motion-check.py" "$d" 2>&1 | sed "s/^/MOTION $style $look $view $1 /" | tee -a "$log"
      rm -rf "$d"
    done
  done
fi

if [ "$batch" = dt ]; then
  log="$out/dt.log"; : > "$log"
  for c in ${DT_COMBOS:-silk:helix:flat stage:club:flat cymatics:stone:flat glass:bubbles:flat cover:cover:flat echo:glow:flat memory:forest:flat}; do
    IFS=: read -r style look view <<< "$c"
    vf=""; [ "$view" = flat ] && vf="--flat"
    node scripts/verify.mjs --dt-sweep --style $style --variant $look $vf --track house-124 --start 44 --secs 4 2>&1 | grep -E "PASS|FAIL|seen|rise|drift|fine|pop|rror" | sed "s/^/DT $style $look $view /" | tee -a "$log"
  done
fi

if [ "$batch" = syncflicker ]; then
  log="$out/syncflicker.log"; : > "$log"
  for c in $NEW; do
    IFS=: read -r style look view <<< "$c"
    vf=""; [ "$view" = flat ] && vf="--flat"
    for L in auto $( [ "$style" = cover ] && echo dark ); do
      tag="$style $look $view $L"
      node scripts/verify.mjs --sync --style $style --variant $look $vf --light $L --track house-124 2>&1 | grep -E "kicks|rror" | sed "s/^/SYNC $tag /" | tee -a "$log"
      node scripts/verify.mjs --flicker --style $style --variant $look $vf --light $L --resp 1 --track dense-128 2>&1 | grep -E "swings|PASS|FAIL|rror" | sed "s/^/FLICKER $tag /" | tee -a "$log"
    done
  done
fi

if [ "$batch" = compile ]; then
  node scripts/compile-time.mjs $NEW ink:glow:depth:glyph ink:glow:depth:reeded voyage:void:flat 2>&1 | grep -E "COMPILE" | tee "$out/compile.log"
fi
