#!/usr/bin/env bash
# Timing-sensitive gates, to run alone on an idle GPU (no other render, gate or
# site job): controller preview cost, pacing with and without the preview tap
# (headed, the real display), synced frame cost for every style / look / view,
# Voyage motion (its raymarch step budget follows measured frame time), and the
# Ink dt sweep. One log: <out>/timing.log.
#   bash scripts/gates-timing.sh [out=verify/gates-1.0.2]
out=${1:-verify/gates-1.0.2}
mkdir -p "$out"
log="$out/timing.log"
: > "$log"
here=$(cd "$(dirname "$0")" && pwd)
run() { echo "## $*" | tee -a "$log"; "$@" 2>&1 | grep -vE "DEP0190|trace-deprecation" | tee -a "$log"; }

# Controller preview: cost on the output's frame (both techniques), 1080p.
for mode in bitmap; do
  run node scripts/verify.mjs --preview-cost --style ink --variant glow --track house-124 --size 1920x1080
  run node scripts/verify.mjs --preview-cost --style voyage --variant void --flat --track house-124 --size 1920x1080
  run node scripts/verify.mjs --preview-cost --style silk --variant silk --track house-124 --size 1920x1080
done
# Pacing on the real display, without and with the preview tap running at its rate.
run node scripts/verify.mjs --pacing --headed --style ink --variant glow --track house-124 --caps 0,-2 --seconds 8
run node scripts/verify.mjs --pacing --headed --preview --style ink --variant glow --track house-124 --caps 0,-2 --seconds 8
run node scripts/verify.mjs --pacing --headed --style voyage --variant void --flat --track house-124 --caps 0 --seconds 8
run node scripts/verify.mjs --pacing --headed --preview --style voyage --variant void --flat --track house-124 --caps 0 --seconds 8
# Synced frame cost, every combo (Medium, 1080p, house-124 drop).
ONLY=cost bash "$here/style-gates.sh" "$out/cost" > /dev/null 2>&1
sed 's/^/  /' "$out/cost/gates.log" | tee -a "$log"
# Voyage motion (frame-time dependent).
ONLY=motion COMBOS="voyage:void:flat voyage:city:flat voyage:ocean:flat" bash "$here/style-gates.sh" "$out/voyage-motion" > /dev/null 2>&1
sed 's/^/  /' "$out/voyage-motion/gates.log" | tee -a "$log"
# Ink: the same passage at 60 / 120 / 165 fps must agree.
run node scripts/verify.mjs --dt-sweep --style ink --variant marble --track ref-song --start 20 --secs 4 --camera planet
echo "timing gates done → $log"
