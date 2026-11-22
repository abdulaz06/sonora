"""Download the CC0 Poly Haven models and ground textures Memory's scenes are built from.

  python scripts/memory/fetch-polyhaven.py <out dir>

Each model: its 1K glTF (the .gltf, its .bin and textures) into <out>/<id>/.
Each ground texture: its 1K diffuse JPEG into <out>/tex/<id>.jpg. Poly Haven:
"All assets are CC0" (https://polyhaven.com/license). Uses the public API
(https://api.polyhaven.com) through curl (a plain client name).
"""
import json
import subprocess
import sys
from pathlib import Path

MODELS = ['pine_sapling_small', 'fir_sapling', 'island_tree_02', 'tree_stump_01', 'tree_stump_02', 'dead_tree_trunk_02',
          'rock_moss_set_01', 'rock_moss_set_02', 'fern_02', 'moss_01', 'root_cluster_01', 'shrub_02', 'shrub_03', 'shrub_04',
          'coast_rocks_01', 'coast_rocks_05', 'sand_rocks_small_01', 'coastal_cliff_01', 'grass_bermuda_01',
          'quiver_tree_01', 'quiver_tree_02', 'namaqualand_boulder_02', 'namaqualand_boulder_03', 'namaqualand_boulder_05',
          'namaqualand_rocks_01', 'flower_ursinia', 'cheiridopsis_succulent', 'dead_quiver_trunk', 'boulder_01', 'stone_01']
TEXTURES = ['forest_ground_04', 'coast_sand_01', 'gravelly_sand']
UA = 'sonora-asset-prep/1.0'


def get(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return
    subprocess.run(['curl', '-s', '-f', '-L', '-A', UA, '-o', str(dest), url], check=True)


def api(path):
    out = subprocess.run(['curl', '-s', '-f', '-A', UA, f'https://api.polyhaven.com/{path}'], check=True, capture_output=True)
    return json.loads(out.stdout)


def main():
    out = Path(sys.argv[1])
    for m in MODELS:
        g = api(f'files/{m}')['gltf']['1k']['gltf']
        get(g['url'], out / m / Path(g['url']).name)
        for rel, v in g.get('include', {}).items():
            get(v['url'], out / m / rel)
        print('model', m)
    for t in TEXTURES:
        d = api(f'files/{t}')
        diff = d['Diffuse']['1k']['jpg']
        get(diff['url'], out / 'tex' / f'{t}.jpg')
        print('texture', t)


if __name__ == '__main__':
    main()
