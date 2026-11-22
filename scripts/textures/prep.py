#!/usr/bin/env python3
"""Voyage world textures, step 1: source images (local-media/textures-src,
git-ignored; sources and licences in ASSETS.md) -> 1024x1024 RGBA rasters in
local-media/textures-src/out/<name>.rgba (8-byte header: width, height LE u32)
plus a preview PNG. scripts/textures/build.mjs encodes them to KTX2.

Detail materials (tiling, seen up close): RGB albedo, A = a height-ish signal
(luminance, normalised) for micro relief.
Aerial imagery (NAIP, large scale): RGB albedo with its baked shadows lifted a
little (our sun casts its own), A = vegetation height (trees and hedgerows read
from the image: dark and green), which the shader raises into canopy relief.

  python -I scripts/textures/prep.py
"""
import os, struct, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'local-media', 'textures-src')
OUT = os.path.join(SRC, 'out')
os.makedirs(OUT, exist_ok=True)
N = 1024

DETAIL = [
    ('d-grass', 'ph/aerial_grass_rock_diff_2k.jpg'),
    ('d-soil', 'ph/aerial_mud_1_diff_2k.jpg'),
    ('d-rock', 'ph/aerial_rocks_02_diff_2k.jpg'),
    ('d-snow', 'ph/snow_field_aerial_col_2k.jpg'),
    ('d-sand', 'ph/aerial_beach_01_diff_2k.jpg'),
    ('d-asphalt', 'ph/aerial_asphalt_01_diff_2k.jpg'),
    ('d-forestfloor', 'acg/Ground037/Ground037_1K-JPG_Color.jpg'),
]
AERIAL = [
    ('a-farm1', 'naip/farm-east.jpg', 'farm'),
    ('a-farm2', 'naip/farm-amish.jpg', 'farm'),
    ('a-farm3', 'naip/farm-lancaster.jpg', 'farm'),
    ('a-shore', 'naip/shore-capecod.jpg', 'farm'),
    ('a-forest', 'naip/forest-vermont.jpg', 'forest'),
    ('a-town', 'naip/town-phila.jpg', 'town'),
]


def save(name, rgb, a):
    rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(a, 0, 255)]).astype(np.uint8)
    h, w = rgba.shape[:2]
    with open(os.path.join(OUT, name + '.rgba'), 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(rgba.tobytes())
    Image.fromarray(rgba[:, :, :3]).save(os.path.join(OUT, name + '.png'))
    Image.fromarray(rgba[:, :, 3]).save(os.path.join(OUT, name + '-a.png'))
    print(f'{name}: {w}x{h}')


def lum(x):
    return 0.2126 * x[:, :, 0] + 0.7152 * x[:, :, 1] + 0.0722 * x[:, :, 2]


def blur(x, r):
    im = Image.fromarray(np.clip(x, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32)


for name, path in DETAIL:
    im = Image.open(os.path.join(SRC, path)).convert('RGB').resize((N, N), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float32)
    l = lum(rgb)
    # Relief: luminance against its local mean (wraps: the textures tile).
    rel = l - blur(np.tile(l, (3, 3)), 12)[N:2 * N, N:2 * N]
    a = 128 + rel * 2.2
    save(name, rgb, a)

for name, path, kind in AERIAL:
    im = Image.open(os.path.join(SRC, path)).convert('RGB').resize((N, N), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float32)
    l = lum(rgb) / 255.0
    r, g, b = rgb[:, :, 0] / 255, rgb[:, :, 1] / 255, rgb[:, :, 2] / 255
    ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
    # Trees and hedgerows: greener than red, rough (crowns), not bright (measured: forest
    # l 0.39, g-r 0.065, roughness 0.28; fields l 0.6-0.66, g-r < 0, roughness 0.08).
    rough = blur(np.abs(l - blur(l * 255, 1.5) / 255) * 6 * 255, 3) / 255
    veg = ss(0.005, 0.05, g - r) * ss(0.12, 0.24, rough) * ss(0.56, 0.42, l)
    if kind == 'forest':
        veg = np.maximum(veg, 0.8)
    veg = blur(veg * 255, 1.2) / 255
    # Crowns: lit tops higher than the gaps between them.
    crown = l - blur(l * 255, 4) / 255
    height = np.clip(veg * (0.7 + crown * 3.0), 0, 1)
    # Lift the image's own shadows (our sun casts new ones), most under trees.
    lift = 1.0 + 0.35 * veg * np.clip((0.3 - l) * 4, 0, 1)
    rgb = rgb * lift[:, :, None]
    save(name, rgb, height * 255)
print('done ->', OUT)
