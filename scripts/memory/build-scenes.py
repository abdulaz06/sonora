"""Build Memory's splat scenes from CC0 Poly Haven photoscans.

  python scripts/memory/build-scenes.py <polyhaven dir> <out dir> [scene ...]

Each scene places photoscanned models (Poly Haven, CC0) along a walkable path
over a textured ground, then samples every surface into oriented disc splats
(area-weighted; colour from the model's diffuse texture; leaves alpha-tested
with their alpha maps). Output, little-endian:

  'SPLT' u32 version, u32 count, f32 min[3], f32 max[3]
  count × 13 bytes: u16 pos[3] (normalised to the bounds), i8 normal[2]
  (octahedral), u8 radius (log2 scale: r = 2^(v/32 - 8) m), u8 rgba[4]
  splats sorted along the path (z), so loading can stream nearest-first.
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RNG = np.random.default_rng(1234)

# ── Scenes ───────────────────────────────────────────────────────
# Each: ground texture, ground extent (x half width, z from, z to), budget,
# and model placements: (model id, count, scale range, |x| range, keep-out of the path).
SCENES = {
    'forest': {
        'ground': 'forest_ground_04', 'gx': 9.0, 'gz': (5.0, -36.0), 'budget': 600_000, 'ground_share': 0.3, 'tile': 2.0,
        'models': [
            ('island_tree_02', 6, (1.8, 2.6), (3.0, 8.5)),
            ('fir_sapling', 10, (1.6, 2.6), (1.8, 8.0)),
            ('pine_sapling_small', 14, (1.8, 3.2), (1.6, 8.0)),
            ('tree_stump_01', 3, (0.9, 1.3), (1.5, 6.0)),
            ('tree_stump_02', 3, (0.9, 1.3), (1.5, 6.0)),
            ('dead_tree_trunk_02', 2, (0.9, 1.1), (2.0, 6.0)),
            ('rock_moss_set_01', 4, (0.8, 1.4), (1.4, 7.0)),
            ('rock_moss_set_02', 4, (0.8, 1.4), (1.4, 7.0)),
            ('root_cluster_01', 3, (0.8, 1.2), (1.2, 5.0)),
            ('fern_02', 30, (0.8, 1.5), (1.0, 8.0)),
            ('shrub_02', 8, (0.8, 1.3), (1.2, 8.0)),
            ('shrub_03', 8, (0.8, 1.3), (1.2, 8.0)),
            ('shrub_04', 8, (0.8, 1.3), (1.2, 8.0)),
            ('moss_01', 20, (0.8, 1.6), (0.9, 8.0)),
        ],
    },
    'coast': {
        # The rocky shore scan is the ground; the cliff line runs along the path as a backdrop.
        'ground': 'coast_sand_01', 'gx': 12.0, 'gz': (5.0, -36.0), 'budget': 580_000, 'ground_share': 0.14, 'tile': 3.0,
        'models': [
            ('coast_rocks_01', [(-6.0, -14.0, 1.2, 0.75)]),
            ('coastal_cliff_01', [(15.0, -16.0, math.pi / 2, 0.55), (-19.0, -30.0, math.pi / 2 + 0.3, 0.45)]),
            ('coast_rocks_05', 6, (0.9, 1.5), (2.0, 9.0)),
            ('sand_rocks_small_01', 6, (0.8, 1.3), (1.5, 9.0)),
            ('grass_bermuda_01', 60, (0.9, 1.8), (1.2, 11.0)),
        ],
    },
    'desert': {
        'ground': 'gravelly_sand', 'gx': 12.0, 'gz': (5.0, -36.0), 'budget': 560_000, 'ground_share': 0.32, 'tile': 2.5,
        'models': [
            ('quiver_tree_01', 10, (1.1, 1.8), (1.6, 8.0)),
            ('quiver_tree_02', 8, (1.2, 2.0), (1.6, 8.0)),
            ('dead_quiver_trunk', 5, (1.0, 1.6), (1.4, 7.0)),
            ('namaqualand_boulder_02', 6, (1.4, 2.6), (1.8, 8.0)),
            ('namaqualand_boulder_03', 6, (1.4, 2.6), (1.8, 8.0)),
            ('namaqualand_boulder_05', 6, (1.4, 2.6), (1.6, 8.0)),
            ('namaqualand_rocks_01', 10, (1.0, 1.6), (1.2, 8.0)),
            ('boulder_01', 5, (1.2, 2.2), (1.8, 8.0)),
            ('cheiridopsis_succulent', 30, (0.9, 1.5), (0.9, 8.0)),
            ('flower_ursinia', 50, (0.9, 1.6), (0.8, 8.0)),
        ],
    },
}

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    s = np.array(n.get('scale', [1, 1, 1]))
    R = quat_mat(n.get('rotation', [0, 0, 0, 1]))
    M[:3, :3] = R * s
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


class Model:
    """Triangles (world space of the model), uvs, per-triangle material textures."""

    def __init__(self, folder: Path):
        gf = next(folder.glob('*.gltf'))
        g = json.loads(gf.read_text(encoding='utf-8'))
        bins = {i: (folder / b['uri']).read_bytes() for i, b in enumerate(g['buffers'])}

        def acc(i):
            a = g['accessors'][i]
            bv = g['bufferViews'][a['bufferView']]
            dt = COMP[a['componentType']]
            n = NCOMP[a['type']]
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            stride = bv.get('byteStride', 0)
            buf = bins[bv['buffer']]
            if stride and stride != n * np.dtype(dt).itemsize:
                raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + n * np.dtype(dt).itemsize, offset=off)
                out = np.stack([np.frombuffer(raw[k * stride:k * stride + n * np.dtype(dt).itemsize].tobytes(), dtype=dt) for k in range(a['count'])])
            else:
                out = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
            out = out.astype(np.float64)
            if a.get('normalized'):
                out /= np.iinfo(dt).max
            return out

        imgs = {}

        def image(idx):
            if idx not in imgs:
                uri = g['images'][g['textures'][idx]['source']]['uri']
                imgs[idx] = np.asarray(Image.open(folder / uri).convert('RGB'), dtype=np.float32) / 255.0
            return imgs[idx]

        def alpha_for(mat):
            name = mat.get('name', '')
            if mat.get('alphaMode', 'OPAQUE') == 'OPAQUE':
                return None
            cands = sorted((folder / 'textures').glob('*alpha*'))
            pick = [c for c in cands if name.split('_')[-1] in c.name] or cands
            if not pick:
                return None
            return np.asarray(Image.open(pick[0]).convert('L'), dtype=np.float32) / 255.0

        tris, uvs, mats = [], [], []
        self.textures = []
        scene = g['scenes'][g.get('scene', 0)]
        stack = [(n, np.eye(4)) for n in scene['nodes']]
        while stack:
            ni, parent = stack.pop()
            node = g['nodes'][ni]
            M = parent @ node_matrix(node)
            for c in node.get('children', []):
                stack.append((c, M))
            if 'mesh' not in node:
                continue
            for prim in g['meshes'][node['mesh']]['primitives']:
                P = acc(prim['attributes']['POSITION'])
                P = (M[:3, :3] @ P.T).T + M[:3, 3]
                UV = acc(prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else np.zeros((len(P), 2))
                I = acc(prim['indices']).astype(np.int64).reshape(-1) if 'indices' in prim else np.arange(len(P))
                I = I.reshape(-1, 3)
                mat = g['materials'][prim['material']] if 'material' in prim else {}
                bct = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index')
                self.textures.append((image(bct) if bct is not None else None, alpha_for(mat),
                                      np.array(mat.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3])))
                tris.append(P[I])
                uvs.append(UV[I])
                mats.append(np.full(len(I), len(self.textures) - 1))
        self.tris = np.concatenate(tris)
        self.uvs = np.concatenate(uvs)
        self.mat = np.concatenate(mats)
        e1 = self.tris[:, 1] - self.tris[:, 0]
        e2 = self.tris[:, 2] - self.tris[:, 0]
        cr = np.cross(e1, e2)
        self.area = 0.5 * np.linalg.norm(cr, axis=1)
        self.nrm = cr / np.maximum(np.linalg.norm(cr, axis=1, keepdims=True), 1e-12)
        self.total = float(self.area.sum())
        lo, hi = self.tris.reshape(-1, 3).min(0), self.tris.reshape(-1, 3).max(0)
        self.size = hi - lo
        self.base = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])

    def sample(self, n):
        """n splats: positions, normals, colours (rgba 0..1), radius."""
        if n <= 0:
            return None
        p = self.area / self.area.sum()
        k = RNG.choice(len(self.area), size=int(n * 1.6), p=p)
        r1, r2 = RNG.random(len(k)), RNG.random(len(k))
        s = np.sqrt(r1)
        b = np.stack([1 - s, s * (1 - r2), s * r2], 1)
        pos = np.einsum('ij,ijk->ik', b, self.tris[k])
        uv = np.einsum('ij,ijk->ik', b, self.uvs[k])
        nrm = self.nrm[k]
        col = np.ones((len(k), 3)) * 0.5
        alpha = np.ones(len(k))
        for mi, (tex, al, fac) in enumerate(self.textures):
            m = self.mat[k] == mi
            if not m.any():
                continue
            u = uv[m]
            if tex is not None:
                h, w, _ = tex.shape
                x = (np.mod(u[:, 0], 1.0) * (w - 1)).astype(int)
                y = (np.mod(u[:, 1], 1.0) * (h - 1)).astype(int)
                col[m] = tex[y, x] * fac
            if al is not None:
                h, w = al.shape
                x = (np.mod(u[:, 0], 1.0) * (w - 1)).astype(int)
                y = (np.mod(u[:, 1], 1.0) * (h - 1)).astype(int)
                alpha[m] = al[y, x]
        keep = alpha > 0.5
        pos, nrm, col = pos[keep][:n], nrm[keep][:n], col[keep][:n]
        rad = np.full(len(pos), math.sqrt(self.total / max(len(pos), 1) / math.pi) * 1.25)
        return pos, nrm, col, rad


def place(models, name, cfg):
    """Instances along the path: (model, position, yaw, scale)."""
    out = []
    z0, z1 = cfg['gz']
    for entry in cfg['models']:
        if isinstance(entry[1], list):
            for x, z, yaw, sc in entry[1]:
                out.append((entry[0], np.array([x, 0.0, z]), yaw, sc))
            continue
        mid, count, srange, xrange = entry
        for _ in range(count):
            side = -1 if RNG.random() < 0.5 else 1
            x = side * RNG.uniform(*xrange)
            z = RNG.uniform(z1 + 2, z0 - 2)
            out.append((mid, np.array([x, 0.0, z]), RNG.uniform(0, 2 * math.pi), RNG.uniform(*srange)))
    return out


def ground(tex_path, cfg, n):
    tex = np.asarray(Image.open(tex_path).convert('RGB'), dtype=np.float32) / 255.0
    h, w, _ = tex.shape
    gx = cfg['gx']
    z0, z1 = cfg['gz']
    x = RNG.uniform(-gx, gx, n)
    z = RNG.uniform(z1, z0, n)
    # gentle rolling ground, a shallow path in the middle
    y = 0.12 * np.sin(x * 0.7) * np.cos(z * 0.33) + 0.06 * np.sin(z * 0.9 + x) - 0.04 * np.exp(-x * x / 1.5)
    tile = cfg['tile']
    u = np.mod(x / tile, 1.0)
    v = np.mod(z / tile, 1.0)
    col = tex[(v * (h - 1)).astype(int), (u * (w - 1)).astype(int)]
    pos = np.stack([x, y, z], 1)
    nrm = np.tile([0.0, 1.0, 0.0], (n, 1))
    area = 2 * gx * (z0 - z1)
    rad = np.full(n, math.sqrt(area / n / math.pi) * 1.3)
    return pos, nrm, col, rad


def oct_encode(n):
    n = n / np.maximum(np.abs(n).sum(1, keepdims=True), 1e-9)
    xy = n[:, :2].copy()
    neg = n[:, 2] < 0
    xy[neg] = (1 - np.abs(xy[neg][:, ::-1])) * np.sign(xy[neg])
    return np.clip(np.round(xy * 127), -127, 127).astype(np.int8)


def build(ph: Path, out: Path, name: str):
    cfg = SCENES[name]
    insts = place(None, name, cfg)
    cache = {}
    for mid, *_ in insts:
        if mid not in cache:
            cache[mid] = Model(ph / mid)
            print(f'  {mid}: {len(cache[mid].tris)} tris, area {cache[mid].total:.1f} m², size {np.round(cache[mid].size, 2)}')
    budget = cfg['budget']
    n_ground = int(budget * cfg['ground_share'])
    parts = [ground(ph / 'tex' / f"{cfg['ground']}.jpg", cfg, n_ground)]
    areas = [cache[m].total * s * s for m, _, _, s in insts]
    tot = sum(areas)
    for (mid, p, yaw, s), a in zip(insts, areas):
        m = cache[mid]
        n = int((budget - n_ground) * a / tot)
        smp = m.sample(n)
        if smp is None:
            continue
        pos, nrm, col, rad = smp
        c, si = math.cos(yaw), math.sin(yaw)
        R = np.array([[c, 0, si], [0, 1, 0], [-si, 0, c]])
        pos = ((pos - m.base) * s) @ R.T + p
        nrm = nrm @ R.T
        parts.append((pos, nrm, col, rad * s))
    pos = np.concatenate([q[0] for q in parts])
    nrm = np.concatenate([q[1] for q in parts])
    col = np.concatenate([q[2] for q in parts])
    rad = np.concatenate([q[3] for q in parts])
    order = np.argsort(-pos[:, 2])
    pos, nrm, col, rad = pos[order], nrm[order], col[order], rad[order]
    lo, hi = pos.min(0), pos.max(0)
    q = np.clip(np.round((pos - lo) / (hi - lo) * 65535), 0, 65535).astype('<u2')
    rq = np.clip(np.round((np.log2(np.maximum(rad, 1e-4)) + 8) * 32), 0, 255).astype(np.uint8)
    cq = np.clip(np.round(np.concatenate([col, np.ones((len(col), 1))], 1) * 255), 0, 255).astype(np.uint8)
    ob = oct_encode(nrm)
    rec = np.zeros(len(pos), dtype=[('p', '<u2', 3), ('n', 'i1', 2), ('r', 'u1'), ('c', 'u1', 4)])
    rec['p'], rec['n'], rec['r'], rec['c'] = q, ob, rq, cq
    out.mkdir(parents=True, exist_ok=True)
    f = out / f'{name}.splat'
    with f.open('wb') as fh:
        fh.write(b'SPLT')
        fh.write(struct.pack('<II', 1, len(pos)))
        fh.write(struct.pack('<6f', *lo, *hi))
        fh.write(rec.tobytes())
    print(f'{name}: {len(pos)} splats, {f.stat().st_size / 1e6:.2f} MB, bounds {np.round(lo, 1)} – {np.round(hi, 1)}')


def main():
    ph, out = Path(sys.argv[1]), Path(sys.argv[2])
    for name in (sys.argv[3:] or list(SCENES)):
        print(name)
        build(ph, out, name)


if __name__ == '__main__':
    main()
