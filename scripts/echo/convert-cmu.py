"""Convert CMU Graphics Lab motion capture (ASF/AMC) into Echo's compact move file.

  python scripts/echo/convert-cmu.py <cmu dir> <out.bin>

For each clip: forward kinematics → world positions of 25 joints (metres, Y up),
resampled to 30 fps, the dancer's horizontal drift slowly re-centred; the
clip's own beat period (autocorrelation of overall joint speed, 0.35–1.3 s)
and the frame of its first strong beat. Written as one little-endian binary:

  'ECHO' u32 version, u32 clipCount, u32 jointCount, u32 boneCount
  bones: boneCount × (u8 a, u8 b)
  per clip: u8 nameLen, name, f32 fps, u32 frames, f32 period, f32 firstBeat,
            frames × joints × 3 × i16 (millimetres)

Data: CMU Graphics Lab Motion Capture Database, mocap.cs.cmu.edu ("free for all
uses"; may be included in products, not resold as data). The database was
created with funding from NSF EIA-0196217.
"""
import math
import struct
import sys
from pathlib import Path

import numpy as np

SCALE = (1.0 / 0.45) * 2.54 / 100.0          # ASF units → metres
FPS_OUT = 30.0
# Clips: file, source fps, start s, end s (the dance part), label.
CLIPS = [
    ('05_02', 120, 0.0, None, 'modern-arms'),
    ('05_06', 120, 0.0, None, 'modern-pirouette'),
    ('05_13', 120, 0.0, None, 'modern-jete'),
    ('60_02', 60, 0.0, None, 'salsa-a'),
    ('60_08', 60, 0.0, None, 'salsa-b'),
    ('55_02', 120, 0.0, None, 'lambada'),
    ('141_12', 120, 0.0, None, 'twist'),
    # 1.2 rework: a wider vocabulary (at most 40 s each).
    ('05_05', 120, 0.0, 40.0, 'modern-tour'),
    ('05_07', 120, 0.0, 40.0, 'modern-attitude'),
    ('05_11', 120, 0.0, 40.0, 'modern-steps'),
    ('05_12', 120, 0.0, 40.0, 'modern-high'),
    ('05_17', 120, 0.0, 40.0, 'modern-leap'),
    ('05_18', 120, 0.0, 40.0, 'modern-bend'),
    ('55_01', 120, 0.0, 40.0, 'whirl'),
    ('60_04', 60, 0.0, 40.0, 'salsa-c'),
    ('60_10', 60, 0.0, 40.0, 'salsa-d'),
    ('61_03', 60, 0.0, 40.0, 'salsa-e'),
    ('61_07', 60, 0.0, 40.0, 'salsa-f'),
    ('61_12', 60, 0.0, 40.0, 'salsa-g'),
    ('90_28', 120, 0.0, 40.0, 'breakdance'),
    ('90_30', 120, 0.0, 40.0, 'russian-a'),
    ('90_31', 120, 0.0, 40.0, 'russian-b'),
    ('120_05', 120, 0.0, 40.0, 'mickey'),
    ('143_35', 120, 0.0, 40.0, 'macarena'),
]
JOINTS = ['root', 'lowerback', 'upperback', 'thorax', 'lowerneck', 'upperneck', 'head',
          'lclavicle', 'lhumerus', 'lradius', 'lwrist', 'lhand',
          'rclavicle', 'rhumerus', 'rradius', 'rwrist', 'rhand',
          'lhipjoint', 'lfemur', 'ltibia', 'lfoot', 'ltoes',
          'rhipjoint', 'rfemur', 'rtibia', 'rfoot', 'rtoes']


def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 'x':
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'y':
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def euler_xyz(x, y, z):
    """Static XYZ: R = Rz · Ry · Rx (as the ASF 'axis … XYZ' convention)."""
    return rot('z', z) @ rot('y', y) @ rot('x', x)


def parse_asf(path):
    lines = [l.strip() for l in Path(path).read_text().splitlines()]
    bones = {'root': {'dir': np.zeros(3), 'len': 0.0, 'C': np.eye(3), 'dof': ['tx', 'ty', 'tz', 'rx', 'ry', 'rz']}}
    hierarchy = {}
    i = 0
    root_axis = euler_xyz(0, 0, 0)
    while i < len(lines):
        l = lines[i]
        if l.startswith(':root'):
            i += 1
            while not lines[i].startswith(':'):
                parts = lines[i].split()
                if parts[0] == 'orientation':
                    root_axis = euler_xyz(*map(float, parts[1:4]))
                i += 1
            bones['root']['C'] = root_axis
            continue
        if l == 'begin' and i + 1 < len(lines) and lines[i + 1].startswith('id'):
            b = {'dof': []}
            i += 1
            while lines[i] != 'end':
                parts = lines[i].split()
                if parts[0] == 'name':
                    name = parts[1]
                elif parts[0] == 'direction':
                    b['dir'] = np.array(list(map(float, parts[1:4])))
                elif parts[0] == 'length':
                    b['len'] = float(parts[1]) * SCALE
                elif parts[0] == 'axis':
                    b['C'] = euler_xyz(*map(float, parts[1:4]))
                elif parts[0] == 'dof':
                    b['dof'] = parts[1:]
                i += 1
            bones[name] = b
        if l == ':hierarchy':
            i += 2  # 'begin'
            while lines[i] != 'end':
                parts = lines[i].split()
                hierarchy[parts[0]] = parts[1:]
                i += 1
        i += 1
    parent = {c: p for p, cs in hierarchy.items() for c in cs}
    return bones, hierarchy, parent


def parse_amc(path):
    frames, cur = [], None
    for l in Path(path).read_text().splitlines():
        l = l.strip()
        if not l or l.startswith('#') or l.startswith(':'):
            continue
        if l.isdigit():
            cur = {}
            frames.append(cur)
            continue
        parts = l.split()
        cur[parts[0]] = list(map(float, parts[1:]))
    return frames


def pose(bones, hierarchy, frame):
    pos, mat = {}, {}
    order = ['root']
    k = 0
    while k < len(order):
        order += hierarchy.get(order[k], [])
        k += 1
    for name in order:
        b = bones[name]
        vals = frame.get(name, [])
        if name == 'root':
            r = dict(zip(b['dof'], vals))
            R = euler_xyz(r.get('rx', 0), r.get('ry', 0), r.get('rz', 0))
            mat[name] = b['C'] @ R @ b['C'].T
            pos[name] = np.array([r.get('tx', 0), r.get('ty', 0), r.get('tz', 0)]) * SCALE
            continue
        p = next(pp for pp, cs in hierarchy.items() if name in cs)
        r = dict(zip(b['dof'], vals))
        R = euler_xyz(r.get('rx', 0), r.get('ry', 0), r.get('rz', 0))
        mat[name] = mat[p] @ b['C'] @ R @ b['C'].T
        pos[name] = pos[p] + b['len'] * (mat[name] @ b['dir'])
    return pos


def beat_period(J, fps):
    """The clip's own beat: autocorrelation of total joint speed (0.35–1.3 s)."""
    v = np.linalg.norm(np.diff(J, axis=0), axis=2).sum(axis=1) * fps
    v = v - v.mean()
    ac = np.correlate(v, v, mode='full')[len(v) - 1:]
    lo, hi = int(0.35 * fps), int(1.3 * fps)
    # the strongest local maximum in range (the global one is the lag-0 slope)
    peaks = [k for k in range(lo, min(hi, len(ac) - 1)) if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1]]
    lag = max(peaks, key=lambda k: ac[k]) if peaks else int(0.5 * fps)
    # first strong beat: the speed peak nearest the start, past the first half second
    k0 = int(0.5 * fps)
    first = k0 + int(np.argmax(v[k0:k0 + lag]))
    return lag / fps, first / fps


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    names = JOINTS
    bones_out = None
    clips = []
    for file, fps_in, t0, t1, label in CLIPS:
        subj = file.split('_')[0]
        bones, hierarchy, parent = parse_asf(src / f'{subj}.asf')
        if bones_out is None:
            bones_out = [(names.index(parent[n]), names.index(n)) for n in names if n in parent and parent[n] in names]
        frames = parse_amc(src / f'{file}.amc')
        step = fps_in / FPS_OUT
        idx = np.arange(int(t0 * fps_in), len(frames) if t1 is None else min(len(frames), int(t1 * fps_in)), step).astype(int)
        J = np.array([[pose(bones, hierarchy, frames[i])[n] for n in names] for i in idx])
        # Keep the dancer near the middle: subtract a slow moving average of the root's x/z.
        k = int(FPS_OUT * 3)
        root = J[:, 0, :].copy()
        pad = np.pad(root, ((k, k), (0, 0)), mode='edge')
        avg = np.array([pad[i:i + 2 * k + 1].mean(axis=0) for i in range(len(root))])
        J[:, :, 0] -= avg[:, None, 0]
        J[:, :, 2] -= avg[:, None, 2]
        # Feet on the floor at y = 0 (lowest toe over the clip).
        J[:, :, 1] -= np.percentile(J[:, [21, 26], 1], 2)
        period, first = beat_period(J, FPS_OUT)
        clips.append((label, J, period, first))
        print(f'{label}: {len(J)} frames ({len(J) / FPS_OUT:.1f} s), beat {period:.3f} s, first beat {first:.2f} s, height {J[:, 6, 1].max():.2f} m')
    with out.open('wb') as f:
        f.write(b'ECHO')
        f.write(struct.pack('<IIII', 1, len(clips), len(names), len(bones_out)))
        for a, b in bones_out:
            f.write(struct.pack('<BB', a, b))
        for label, J, period, first in clips:
            nb = label.encode()
            f.write(struct.pack('<B', len(nb)))
            f.write(nb)
            f.write(struct.pack('<fIff', FPS_OUT, len(J), period, first))
            f.write(np.clip(np.round(J * 1000), -32767, 32767).astype('<i2').tobytes())
    print(f'wrote {out} ({out.stat().st_size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
