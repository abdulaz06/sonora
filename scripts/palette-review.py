#!/usr/bin/env python3
"""Review package for a palette overhaul: before/after sheets from two palette matrices.

    python scripts/palette-review.py <before frames> <after frames> <after sheets dir> <out dir>

Writes into <out dir>:
  before-after.jpg          every combo: the old set (left) and the new set (right), one drop frame each
  voyage-before-after.jpg   Voyage on each backdrop, old vs new palette (matched by name; Gold → Solar)
  palette-<name>.jpg        copied from the new set's sheets (every style / look / view)
  metrics.md                copied from the new set
"""
import json
import os
import re
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

RENAMES = {'Gold': 'Solar'}


def font(size):
    for f in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def safe(name):
    return re.sub(r'[^\w-]+', '_', name)


def frame(root, combo, pal, track, tag, size):
    p = os.path.join(root, combo, safe(pal), f'{track}-{tag}.png')
    if not os.path.exists(p):
        return None
    return Image.open(p).convert('RGB').resize(size, Image.LANCZOS)


def before_after(bi, ai, broot, aroot, out):
    tw, th = 176, 99
    combos = [c['id'] for c in ai['combos']]
    bp = [p['name'] for p in bi['palettes']]
    ap = [p['name'] for p in ai['palettes']]
    track = ai['tracks'][0]
    gap = 40
    W = 210 + tw * len(bp) + gap + tw * len(ap)
    H = 50 + th * len(combos)
    img = Image.new('RGB', (W, H), (12, 12, 14))
    d = ImageDraw.Draw(img)
    f11, f13, f16 = font(11), font(13), font(16)
    d.text((10, 8), 'before (1.0 palettes)', fill=(236, 231, 223), font=f16)
    d.text((210 + tw * len(bp) + gap, 8), 'after (new set)', fill=(236, 231, 223), font=f16)
    for i, n in enumerate(bp):
        d.text((210 + i * tw + 4, 32), n[:20], fill=(150, 150, 150), font=f11)
    for i, n in enumerate(ap):
        d.text((210 + tw * len(bp) + gap + i * tw + 4, 32), n[:20], fill=(150, 150, 150), font=f11)
    for r, c in enumerate(combos):
        y = 50 + r * th
        d.text((10, y + th // 2 - 7), c, fill=(236, 231, 223), font=f13)
        for i, n in enumerate(bp):
            im = frame(broot, c, n, track, 'drop1', (tw, th))
            if im:
                img.paste(im, (210 + i * tw, y))
        for i, n in enumerate(ap):
            im = frame(aroot, c, n, track, 'drop1', (tw, th))
            if im:
                img.paste(im, (210 + tw * len(bp) + gap + i * tw, y))
    img.save(os.path.join(out, 'before-after.jpg'), quality=86)


def voyage(bi, ai, broot, aroot, out):
    tw, th = 320, 180
    backdrops = ['voyage-void', 'voyage-city', 'voyage-ocean']
    ap = [p['name'] for p in ai['palettes']]
    bp = {RENAMES.get(p['name'], p['name']): p['name'] for p in bi['palettes'] if ' / ' not in p['name']}
    track = ai['tracks'][0]
    W = 130 + 2 * tw * len(backdrops) + 20 * len(backdrops)
    H = 50 + th * len(ap)
    img = Image.new('RGB', (W, H), (12, 12, 14))
    d = ImageDraw.Draw(img)
    f13 = font(13)
    for j, b in enumerate(backdrops):
        x = 130 + j * (2 * tw + 20)
        d.text((x + 6, 10), f'{b}  before', fill=(150, 150, 150), font=f13)
        d.text((x + tw + 6, 10), 'after', fill=(236, 231, 223), font=f13)
    for r, n in enumerate(ap):
        y = 50 + r * th
        label = n if n in bp else f'{n} (new)'
        if n in bp and bp[n] != n:
            label = f'{bp[n]} → {n}'
        d.text((8, y + th // 2 - 7), label, fill=(236, 231, 223), font=f13)
        for j, b in enumerate(backdrops):
            x = 130 + j * (2 * tw + 20)
            tag = 'calm' if b != 'voyage-void' else 'drop1'
            if n in bp:
                im = frame(broot, b, bp[n], track, tag, (tw, th))
                if im:
                    img.paste(im, (x, y))
            im = frame(aroot, b, n, track, tag, (tw, th))
            if im:
                img.paste(im, (x + tw, y))
    img.save(os.path.join(out, 'voyage-before-after.jpg'), quality=86)


def main():
    broot, aroot, asheets, out = sys.argv[1:5]
    os.makedirs(out, exist_ok=True)
    bi = json.load(open(os.path.join(broot, 'index.json')))
    ai = json.load(open(os.path.join(aroot, 'index.json')))
    before_after(bi, ai, broot, aroot, out)
    voyage(bi, ai, broot, aroot, out)
    for f in os.listdir(asheets):
        if f.startswith('palette-') or f in ('metrics.md', 'overview.jpg'):
            shutil.copy(os.path.join(asheets, f), os.path.join(out, f))
    print(f'review -> {out}')


if __name__ == '__main__':
    main()
