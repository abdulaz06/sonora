"""Turn a recording (video or audio) into a private harness track.

Usage:
  python scripts/add-local-track.py <video-or-audio> <name> [--drop s] [--build s] [--breakdown s] [--fade-in s]

Writes test-audio/local/<name>.wav (mono, 44.1 kHz) and adds an entry with
detected kicks to test-audio/local/tracks.json. That folder is git-ignored:
real songs are never committed. The harness loads these tracks next to the
procedural ones (`npm run verify -- --track <name>` and the other scripts).
Section markers default to rough guesses from the kick pattern; pass them
explicitly when you know them.
"""
import argparse
import json
import os
import subprocess
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'test-audio', 'local')

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('name')
ap.add_argument('--drop', type=float)
ap.add_argument('--build', type=float)
ap.add_argument('--breakdown', type=float)
ap.add_argument('--fade-in', type=float)
args = ap.parse_args()

import imageio_ffmpeg  # noqa: E402  (pip install imageio-ffmpeg)

os.makedirs(OUT, exist_ok=True)
wav = os.path.join(OUT, f'{args.name}.wav')
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y', '-i', args.src,
                '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav], check=True)

with wave.open(wav) as w:
    sr = w.getframerate()
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
dur = len(a) / sr

# Kicks: onsets of the 35-150 Hz band energy.
hop, win = sr // 120, 2048
n = (len(a) - win) // hop
f = np.fft.rfftfreq(win, 1 / sr)
band = (f > 35) & (f < 150)
hann = np.hanning(win)
E = np.log1p(np.array([np.sum(np.abs(np.fft.rfft(a[i * hop:i * hop + win] * hann))[band] ** 2) for i in range(n)]) * 100)
flux = np.maximum(0, np.diff(E, prepend=E[0]))
t = (np.arange(n) * hop + win / 2) / sr
thr = np.percentile(flux, 97)
kicks, last = [], -1.0
for i in range(1, n - 1):
    if flux[i] > thr and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1] and t[i] - last > 0.25:
        kicks.append(round(float(t[i]), 4)); last = float(t[i])

# Rough markers: the drop is the start of the longest run of steady kicks.
iv = np.diff(kicks) if len(kicks) > 2 else np.array([0.5])
beat = float(np.median(iv)) if len(iv) else 0.5
runs, start = [], 0
for i in range(1, len(kicks)):
    if abs(kicks[i] - kicks[i - 1] - beat) > beat * 0.25:
        runs.append((start, i - 1)); start = i
runs.append((start, len(kicks) - 1))
s0, s1 = max(runs, key=lambda r: r[1] - r[0]) if kicks else (0, 0)
drop = args.drop if args.drop is not None else (kicks[s0] if kicks else dur / 3)
breakdown = args.breakdown if args.breakdown is not None else (kicks[s1] + beat if kicks else dur * 2 / 3)
build = args.build if args.build is not None else max(0.0, drop - 8 * beat)
fade_in = args.fade_in if args.fade_in is not None else min(2.0, build)

meta = {
    'file': f'local/{args.name}.wav', 'duration': round(dur, 3), 'sampleRate': sr,
    'markers': {'silence': 0.0, 'fadeIn': fade_in, 'build': build, 'drop': drop, 'breakdown': breakdown},
    'sections': [['intro', 0, build], ['build', build, drop], ['drop', drop, breakdown], ['breakdown', breakdown, dur]],
    'kicks': kicks,
}
idx = os.path.join(OUT, 'tracks.json')
tracks = json.load(open(idx)) if os.path.exists(idx) else {}
tracks[args.name] = meta
json.dump(tracks, open(idx, 'w'), indent=1)
print(f'{args.name}: {dur:.1f} s, {len(kicks)} kicks (~{60 / beat:.0f} BPM), drop {drop:.2f}, breakdown {breakdown:.2f} -> {wav}')
