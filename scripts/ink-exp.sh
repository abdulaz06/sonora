#!/usr/bin/env bash
# One-factor experiments for Ink on the same seeded passage.
# Usage: scripts/ink-exp.sh <name> '<debug json>' [look] [view] [track] [start] [secs] [WxH] [fps]
# Renders to $EXP_DIR/<name> (default verify/ink-fix/exp), prints jaggedness
# (+ pop with POP=1, motion with MOTION=1), then deletes the frames unless KEEP=1.
# Env: CAMERA (default planet), PALETTE (default 2 = Ember), JAG_EVERY (default 3).
name=$1; dbg=$2; look=${3:-marble}; view=${4:-depth}; track=${5:-house-124}; start=${6:-50.5}; secs=${7:-1.5}; size=${8:-1280x720}; fps=${9:-60}
d=${EXP_DIR:-verify/ink-fix/exp}/$name
rm -rf "$d"
SEQ_W=${size%x*} SEQ_H=${size#*x} SEQ_FPS=$fps SEQ_CAMERA=${CAMERA:-planet} SEQ_PALETTE=${PALETTE:-2} SEQ_DEBUG="$dbg" node scripts/frame-seq.mjs ink $look $track $start $secs $view 1 "$d" 2>&1 | grep -iE "error|exception" 
echo "== $name ($look $view $track@$start, $dbg)"
[ -z "$NOJAG" ] && python scripts/ink-metrics.py jag "$d" --every ${JAG_EVERY:-3}
[ -n "$POP" ] && python scripts/ink-metrics.py pop "$d"
[ -n "$MOTION" ] && python scripts/ink-metrics.py motion "$d"
[ -z "$KEEP" ] && rm -rf "$d"
true
