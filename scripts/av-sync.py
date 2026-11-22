#!/usr/bin/env python3
"""A/V sync of a video made with the sync probe on (debugFlags.syncFlash): the
clicks' times in its audio against the first frame whose bottom-left corner
turns white after each click. Pass: every pair within one frame.

  python scripts/av-sync.py <video.mp4> [--json]
"""
import json, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np

def ffmpeg():
    return subprocess.check_output(['node', '-e', "import('ffmpeg-static').then(m=>console.log(m.default))"], text=True).strip()

def main():
    path = sys.argv[1]
    ff = ffmpeg()
    info = subprocess.run([ff, '-hide_banner', '-i', path], capture_output=True, text=True).stderr
    import re
    m = re.search(r'(\d+(?:\.\d+)?) fps', info)
    fps = float(m.group(1)) if m else 60.0
    sr = 48000
    a = np.frombuffer(subprocess.check_output([ff, '-v', 'error', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']), dtype=np.float32)
    # Clicks: rising through 0.25 after 0.2 s of quiet.
    clicks, last = [], -1e9
    above = np.abs(a) > 0.25
    idx = np.flatnonzero(above[1:] & ~above[:-1]) + 1
    for i in idx:
        if i - last > sr * 0.2:
            clicks.append(i / sr); last = i
    # Video: mean of the bottom-left 6% square per frame (gray).
    v = subprocess.check_output([ff, '-v', 'error', '-i', path, '-map', '0:v:0', '-vf', 'crop=iw*0.06:iw*0.06:0:ih-iw*0.06,scale=8:8,format=gray', '-f', 'rawvideo', '-'])
    fr = np.frombuffer(v, dtype=np.uint8).reshape(-1, 64).mean(axis=1)
    on = fr > 200
    starts = [k / fps for k in np.flatnonzero(on[1:] & ~on[:-1]) + 1]
    pairs = []
    for c in clicks:
        nxt = [s for s in starts if s >= c - 2.5 / fps]
        if nxt and nxt[0] - c < 0.25:
            pairs.append(nxt[0] - c)
    frame = 1 / fps
    d = np.array(pairs) if pairs else np.array([np.nan])
    # A flash at frame k shows audio up to (k+1)/fps: the reaction counts from the frame's end.
    lag_ms = d * 1000
    res = {
        'fps': fps, 'clicks': len(clicks), 'flashes': len(starts), 'paired': len(pairs),
        'mean_ms': float(np.nanmean(lag_ms)), 'min_ms': float(np.nanmin(lag_ms)), 'max_ms': float(np.nanmax(lag_ms)), 'p95_ms': float(np.nanpercentile(lag_ms, 95)),
        'frame_ms': frame * 1000,
    }
    res['pass'] = bool(res['paired'] >= 0.9 * max(1, res['clicks']) and res['max_ms'] <= frame * 1000 + 0.5 and res['min_ms'] >= -frame * 1000 - 0.5)
    if '--json' in sys.argv:
        print(json.dumps(res))
    else:
        print(f"A/V sync: {res['paired']}/{res['clicks']} clicks paired · flash − click: mean {res['mean_ms']:.1f} ms, range {res['min_ms']:.1f} … {res['max_ms']:.1f} ms (one frame = {res['frame_ms']:.1f} ms) → {'PASS' if res['pass'] else 'FAIL'}")

main()
