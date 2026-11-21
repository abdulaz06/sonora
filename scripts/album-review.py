"""Album colours review sheets: per cover, the cover, its colour clusters (area
bars), the palette the app builds from it, and a frame of it in each style from
the palette matrix (verify/palettes/album). Covers the app ignores (grey,
black and white) are listed with their reason.

    python scripts/album-review.py [frames root] [out dir]
      frames root: the palette matrix's frames (default C:/Users/abdul/sonora-palette-frames/album)
      out dir:     verify/album (review-1.jpg, review-2.jpg, …)
"""
import colorsys
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
FR = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/abdul/sonora-palette-frames/album'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'verify', 'album')
COMBOS = [('ink-glow-depth', 'ink glow'), ('ink-marble-flat', 'ink marble'), ('silk-depth', 'silk depth'), ('wisp-ground', 'wisp'), ('warp', 'warp'), ('voyage-void', 'voyage void'), ('voyage-ocean', 'voyage ocean')]
SHOT = 'house-124-drop1.png'
ROW_H, COVER = 150, 150
FW = int(ROW_H * 16 / 9)
BG, BONE, DIM = (8, 8, 10), (236, 231, 223), (140, 136, 130)


def font(sz):
    for f in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def oklch_rgb(l, c, h):
    a, b = c * math.cos(math.radians(h)), c * math.sin(math.radians(h))
    l_, m_, s_ = l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b
    l3, m3, s3 = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = [4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3]
    enc = lambda x: 12.92 * x if x <= 0.0031308 else 1.055 * max(x, 0) ** (1 / 2.4) - 0.055
    return tuple(int(max(0, min(1, enc(x))) * 255) for x in rgb)


def main():
    ext = json.load(open(os.path.join(OUT, 'extract.json'), encoding='utf8'))
    f_small, f_lbl = font(12), font(11)
    W = COVER + 12 + 120 + 12 + 150 + 12 + len(COMBOS) * (FW + 4)
    rows = []
    for e in ext:
        row = Image.new('RGB', (W, ROW_H + 18), BG)
        d = ImageDraw.Draw(row)
        d.text((4, 2), f"{e['name']} · {e['kind']}" + (f" · hues {', '.join(str(round(e['hues'][k])) + '°' for k in ('primary', 'secondary', 'accent') if e['hues'].get(k) is not None)}" if e.get('hues') else ''), fill=BONE, font=f_small)
        y = 18
        try:
            cv = Image.open(e['file']).convert('RGB').resize((COVER, ROW_H))
            row.paste(cv, (0, y))
        except Exception:
            pass
        x = COVER + 12
        # Clusters: swatch + area bar (vivid ones outlined).
        for i, c in enumerate(sorted(e['colours'], key=lambda c: -c['share'])[:8]):
            col = oklch_rgb(*c['lch'])
            yy = y + i * (ROW_H // 8)
            d.rectangle([x, yy + 2, x + 18, yy + ROW_H // 8 - 2], fill=col, outline=None if c['neutral'] else BONE)
            d.rectangle([x + 24, yy + 6, x + 24 + int(90 * c['share']), yy + ROW_H // 8 - 6], fill=DIM)
        x += 120 + 12
        # The palette the app builds.
        if e.get('resolved'):
            r = e['resolved']
            for i, k in enumerate(['primary', 'secondary', 'accent', 'highlight', 'bg']):
                col = tuple(int(v * 255) for v in r[k])
                d.rectangle([x, y + i * 30, x + 150, y + i * 30 + 26], fill=col)
                d.text((x + 4, y + i * 30 + 7), k, fill=BG if sum(col) > 380 else BONE, font=f_lbl)
        else:
            d.text((x, y + 60), 'no palette:\nthe chosen one stays', fill=DIM, font=f_small)
        x += 150 + 12
        for cid, lbl in COMBOS:
            p = os.path.join(FR, cid, e['name'], SHOT)
            if e.get('resolved') and os.path.exists(p):
                row.paste(Image.open(p).convert('RGB').resize((FW, ROW_H)), (x, y))
            if not rows:
                pass
            x += FW + 4
        rows.append(row)
    head = Image.new('RGB', (W, 22), BG)
    hd = ImageDraw.Draw(head)
    hd.text((4, 4), 'cover', fill=BONE, font=f_small)
    hd.text((COVER + 12, 4), 'clusters', fill=BONE, font=f_small)
    hd.text((COVER + 144, 4), 'palette', fill=BONE, font=f_small)
    for i, (_, lbl) in enumerate(COMBOS):
        hd.text((COVER + 306 + i * (FW + 4), 4), lbl, fill=BONE, font=f_small)
    per = 10
    for p in range(0, len(rows), per):
        part = rows[p:p + per]
        sheet = Image.new('RGB', (W, 22 + sum(r.height for r in part)), BG)
        sheet.paste(head, (0, 0))
        yy = 22
        for r in part:
            sheet.paste(r, (0, yy))
            yy += r.height
        f = os.path.join(OUT, f'review-{p // per + 1}.jpg')
        sheet.save(f, quality=86)
        print(f)


if __name__ == '__main__':
    main()
