#!/usr/bin/env bash
# Before/after video for Abdul: the same seeded passage rendered with Ink's
# previous behaviour (left) and the fix (right), at 165 fps timing, side by
# side; one file at real speed (165 fps) and one at 4x slow motion.
# Usage: scripts/ink-ab-video.sh <look> <view> <track> <start> <secs> [name] [slow]
# Env: CAMERA (default planet), PALETTE (default 2 = Ember), SEQ_WARMUP (default 20), W/H (each half, default 960x540)
look=$1; view=$2; track=$3; start=$4; secs=$5; name=${6:-$look-$view}; slow=${7:-4}
out=verify/ink-fix/videos
tmp=${EXP_DIR:-verify/ink-fix/exp}/ab-$name
mkdir -p "$out" "$tmp"
FF=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
for side in before after; do
  dbg='{"inkLegacy":false,"inkExp":{}}'; [ $side = before ] && dbg='{"inkLegacy":true}'
  SEQ_JPG=1 SEQ_W=${W:-960} SEQ_H=${H:-540} SEQ_FPS=165 SEQ_CAMERA=${CAMERA:-planet} SEQ_PALETTE=${PALETTE:-2} SEQ_WARMUP=${SEQ_WARMUP:-20} SEQ_DEBUG="$dbg" \
    node scripts/frame-seq.mjs ink $look $track $start $secs $view 1 "$tmp/$side" > /dev/null 2>&1
done
font="C\:/Windows/Fonts/consola.ttf"
lab="drawtext=fontfile='$font':fontsize=18:fontcolor=0xECE7DF@0.8:x=16:y=14:text"
filter="[0:v]$lab='BEFORE (previous behaviour)'[a];[1:v]$lab='AFTER (fix)'[b];[a][b]hstack=inputs=2"
"$FF" -y -loglevel error -framerate 165 -i "$tmp/before/f%05d.jpg" -framerate 165 -i "$tmp/after/f%05d.jpg" -filter_complex "$filter" -c:v libx264 -crf 16 -pix_fmt yuv420p -r 165 "$out/$name-realtime-165fps.mp4"
"$FF" -y -loglevel error -framerate $(python -c "print(165/$slow)") -i "$tmp/before/f%05d.jpg" -framerate $(python -c "print(165/$slow)") -i "$tmp/after/f%05d.jpg" -filter_complex "$filter" -c:v libx264 -crf 16 -pix_fmt yuv420p "$out/$name-slow${slow}x.mp4"
[ -z "$KEEP" ] && rm -rf "$tmp"
ls -la "$out" | grep "$name"
