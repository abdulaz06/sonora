#!/usr/bin/env python3
"""Colour metrics + contact sheets for a palette matrix (scripts/palette-matrix.mjs).

    python scripts/palette-metrics.py <frames dir> <sheet dir> [--no-sheets]
    python scripts/palette-metrics.py compare <metrics a.json> <metrics b.json>

Per frame, on the content pixels (lit pixels on dark looks, ink on paper looks):
  chroma  mean OKLCH chroma                      (colourfulness)
  M       Hasler-Suesstrunk colourfulness, 0-255 sRGB
  grey    share with chroma < C_GREY             (the "just accents" failure)
  white   share that is near-white and grey      (part of grey)
  off     chroma-weighted share whose hue is far from every palette hue
          (and from the arcs between nearby palette hues): mixed into
          something the palette doesn't contain
  olive   share of yellow-hued (75-125 deg) pixels darker than L 0.62
  L, L95  mean / 95th percentile OKLab L of the content (perceived exposure)
  Lall    mean OKLab L of the whole frame
  sep     OKLab dE x100 between the two k-means clusters of the content
  minor   share of the smaller cluster (sep means little when tiny)
Per palette, analytic: dE x100 between the slots the styles draw as large
separate layers (Ink A vs B = primary vs accent; Sumi ink vs paper).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── Tuning ──────────────────────────────────────────────────────
L_LIT = 0.33          # content on dark looks: OKLab L above this
PAPER_DROP = 0.07     # content on paper looks: this much darker than the paper
C_GREY = 0.04         # chroma below this reads as grey / white
HUE_TOL = 30.0        # degrees from a palette hue still counts as on-palette
ARC_MAX = 75.0        # palette hues this close blend along the arc between them
OLIVE_H = (75, 125)  # dark yellows read olive from ~75 deg (Solar at 76 in Marble light, by eye)
THUMB = (320, 180)

# ── Colour maths ────────────────────────────────────────────────

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_oklab(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], -1)


def srgb_to_oklab(c):
    return linear_to_oklab(srgb_to_linear(np.asarray(c, dtype=np.float64)))


def lch(lab):
    C = np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    return lab[..., 0], C, h


def hue_dist(a, b):
    d = np.abs(a - b) % 360
    return np.minimum(d, 360 - d)


def palette_hues(pal):
    """OKLCH hues of the coloured slots, plus arcs between nearby ones."""
    hs = []
    for k in ('primary', 'secondary', 'accent', 'highlight'):
        lab = srgb_to_oklab(np.array(pal[k]))
        _, C, h = lch(lab)
        if C > 0.03:
            hs.append(float(h))
    arcs = []
    for i in range(len(hs)):
        for j in range(i + 1, len(hs)):
            if hue_dist(hs[i], hs[j]) <= ARC_MAX:
                arcs.append((hs[i], hs[j]))
    return hs, arcs


def off_palette(h, hs, arcs):
    """Boolean: hue h is farther than HUE_TOL from every palette hue / arc."""
    if not hs:
        return np.zeros_like(h, dtype=bool)
    d = np.min([hue_dist(h, x) for x in hs], axis=0)
    for a, b in arcs:
        # Distance to the shorter arc a..b.
        span = hue_dist(a, b)
        da, db = hue_dist(h, a), hue_dist(h, b)
        inside = (da <= span) & (db <= span)
        d = np.where(inside, 0.0, d)
    return d > HUE_TOL


def kmeans2(x, iters=12, seed=0):
    rng = np.random.default_rng(seed)
    if len(x) < 20:
        return 0.0, 0.0
    c = x[rng.choice(len(x), 2, replace=False)]
    # Start from the two most distant of a few candidates (stable result).
    cand = x[rng.choice(len(x), min(64, len(x)), replace=False)]
    dd = np.linalg.norm(cand[:, None] - cand[None], axis=-1)
    i, j = np.unravel_index(np.argmax(dd), dd.shape)
    c = np.stack([cand[i], cand[j]])
    for _ in range(iters):
        lab = np.argmin(np.linalg.norm(x[:, None] - c[None], axis=-1), axis=1)
        for k in range(2):
            if np.any(lab == k):
                c[k] = x[lab == k].mean(0)
    share = np.mean(lab == 1)
    return float(np.linalg.norm(c[0] - c[1]) * 100), float(min(share, 1 - share))


def is_paper(combo):
    if combo.get('light') == 'light':
        return True
    return combo['variant'] == 'sumi' and combo.get('light', 'auto') == 'auto'


def frame_metrics(path, pal, combo):
    im = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255.0
    lab = srgb_to_oklab(im)
    L, C, h = lch(lab)
    # Paper looks, and dark looks during an inversion cut (Silk's drop), are
    # measured as ink on paper: the content is what is darker than the page.
    if is_paper(combo) or float(np.median(L)) > 0.6:
        paperL = float(np.percentile(L, 90))
        mask = L < paperL - PAPER_DROP
    else:
        mask = L > L_LIT
    n = int(mask.sum())
    out = {'lit': n / mask.size, 'Lall': float(L.mean())}
    if n < 50:
        out.update(chroma=0.0, M=0.0, grey=1.0, white=0.0, off=0.0, olive=0.0, L=0.0, L95=0.0, sep=0.0, minor=0.0)
        return out
    Lc, Cc, hc = L[mask], C[mask], h[mask]
    rgb = im[mask] * 255
    rg = rgb[:, 0] - rgb[:, 1]
    yb = 0.5 * (rgb[:, 0] + rgb[:, 1]) - rgb[:, 2]
    M = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    grey = Cc < C_GREY
    hs, arcs = palette_hues(pal)
    col = ~grey
    off = off_palette(hc[col], hs, arcs)
    w = Cc[col]
    off_share = float((w * off).sum() / max(w.sum(), 1e-9)) if col.any() else 0.0
    # Dark yellows read olive: below L 0.62 from 95 deg, but toward amber only
    # when darker (L 0.50 at 75 deg) — a medium gold reads gold, by eye.
    lmax = 0.50 + 0.12 * np.clip((hc - OLIVE_H[0]) / 20.0, 0.0, 1.0)
    olive = (hc > OLIVE_H[0]) & (hc < OLIVE_H[1]) & (Lc < lmax) & (Cc > 0.03)
    sub = lab[mask]
    if len(sub) > 6000:
        sub = sub[np.random.default_rng(1).choice(len(sub), 6000, replace=False)]
    sep, minor = kmeans2(sub)
    out.update(
        chroma=float(Cc.mean()), M=float(M), grey=float(grey.mean()),
        white=float((grey & (Lc > 0.85)).mean()), off=off_share, olive=float(olive.mean()),
        L=float(Lc.mean()), L95=float(np.percentile(Lc, 95)), sep=sep, minor=minor,
    )
    return out


def analytic(pal):
    lab = {k: srgb_to_oklab(np.array(pal[k])) for k in ('bg', 'paper', 'primary', 'secondary', 'accent', 'highlight')}
    d = lambda a, b: float(np.linalg.norm(lab[a] - lab[b]) * 100)
    Lp, Cp, hp = lch(lab['primary'])
    return {
        'dE_A_B': d('primary', 'accent'),
        'dE_pri_sec': d('primary', 'secondary'),
        'dE_pri_bg': d('primary', 'bg'),
        'hue_pri_sec': float(hue_dist(lch(lab['primary'])[2], lch(lab['secondary'])[2])),
        'L_pri': float(Lp), 'C_pri': float(Cp), 'h_pri': float(hp),
    }


KEYS = ['chroma', 'M', 'grey', 'white', 'off', 'olive', 'L', 'L95', 'Lall', 'sep', 'minor', 'lit']


def run(frames, sheets, make_sheets=True):
    idx = json.load(open(os.path.join(frames, 'index.json')))
    res = {'name': idx['name'], 'combos': {}, 'palettes': {}}
    for p in idx['palettes']:
        res['palettes'][p['name']] = {'resolved': p['resolved'], **analytic(p['resolved'])}
    for combo in idx['combos']:
        cr = res['combos'].setdefault(combo['id'], {})
        for p in idx['palettes']:
            d = os.path.join(frames, combo['id'], safe(p['name']))
            per = []
            for tr in idx['tracks']:
                for tag, _ in idx['shots'][tr]:
                    f = os.path.join(d, f'{tr}-{tag}.png')
                    if os.path.exists(f):
                        per.append(frame_metrics(f, p['resolved'], combo))
            if not per:
                continue
            cr[p['name']] = {k: float(np.mean([m[k] for m in per])) for k in KEYS}
        print(f'  {combo["id"]}: {len(cr)} palettes')
    os.makedirs(sheets, exist_ok=True)
    json.dump(res, open(os.path.join(sheets, 'metrics.json'), 'w'), indent=1)
    write_table(res, os.path.join(sheets, 'metrics.md'))
    if make_sheets:
        contact_sheets(idx, frames, sheets)
    print(f'metrics -> {sheets}/metrics.json, metrics.md')
    return res


def safe(name):
    import re
    return re.sub(r'[^\w-]+', '_', name)


def write_table(res, path):
    pals = list(res['palettes'])
    lines = [f'# Palette metrics: {res["name"]}', '',
             'chroma (mean OKLCH C of content) · grey share % · off-palette % · mean L · sep dE', '']
    combos = list(res['combos'])
    lines.append('| combo | ' + ' | '.join(pals) + ' |')
    lines.append('|---|' + '---|' * len(pals))
    for c in combos:
        row = []
        for p in pals:
            m = res['combos'][c].get(p)
            row.append('—' if not m else f"{m['chroma']:.3f} · {m['grey']*100:.0f}% · {m['off']*100:.0f}% · {m['L']:.2f} · {m['sep']:.0f}")
        lines.append(f'| {c} | ' + ' | '.join(row) + ' |')
    lines += ['', '## Palettes (analytic)', '', '| palette | L pri | C pri | h pri | hue pri-sec | dE A-B | dE pri-sec |', '|---|---|---|---|---|---|---|']
    for p, a in res['palettes'].items():
        lines.append(f"| {p} | {a['L_pri']:.3f} | {a['C_pri']:.3f} | {a['h_pri']:.0f} | {a['hue_pri_sec']:.0f} | {a['dE_A_B']:.1f} | {a['dE_pri_sec']:.1f} |")
    open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


def font(size):
    for f in ('C:/Windows/Fonts/consola.ttf', 'C:/Windows/Fonts/arial.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def swatches(draw, x, y, pal, s=18):
    for i, k in enumerate(('bg', 'primary', 'secondary', 'accent', 'highlight', 'paper')):
        c = tuple(int(max(0, min(1, v)) * 255) for v in pal[k])
        draw.rectangle([x + i * (s + 3), y, x + i * (s + 3) + s, y + s], fill=c, outline=(60, 60, 60))


def sheet_cols(idx):
    cols = []
    for tr in idx['tracks']:
        for tag in ('build', 'drop1', 'calm'):
            cols.append((tr, tag))
    return cols


def contact_sheets(idx, frames, out):
    tw, th = THUMB
    cols = sheet_cols(idx)
    f14, f18 = font(14), font(18)
    lab_w = 230
    # One sheet per palette: rows = combos.
    for p in idx['palettes']:
        rows = idx['combos']
        img = Image.new('RGB', (lab_w + tw * len(cols), 40 + th * len(rows)), (12, 12, 14))
        dr = ImageDraw.Draw(img)
        dr.text((10, 10), f"{p['name']}", fill=(236, 231, 223), font=f18)
        swatches(dr, 140, 10, p['resolved'])
        for ci, (tr, tag) in enumerate(cols):
            dr.text((lab_w + ci * tw + 6, 22), f'{tr} {tag}', fill=(150, 150, 150), font=f14)
        for ri, combo in enumerate(rows):
            y = 40 + ri * th
            dr.text((10, y + th // 2 - 8), combo['id'], fill=(236, 231, 223), font=f14)
            for ci, (tr, tag) in enumerate(cols):
                fp = os.path.join(frames, combo['id'], safe(p['name']), f'{tr}-{tag}.png')
                if os.path.exists(fp):
                    img.paste(Image.open(fp).convert('RGB').resize(THUMB, Image.LANCZOS), (lab_w + ci * tw, y))
        img.save(os.path.join(out, f"palette-{safe(p['name'])}.jpg"), quality=86)
    # One sheet per combo: rows = palettes.
    for combo in idx['combos']:
        rows = idx['palettes']
        img = Image.new('RGB', (lab_w + tw * len(cols), 40 + th * len(rows)), (12, 12, 14))
        dr = ImageDraw.Draw(img)
        dr.text((10, 10), combo['id'], fill=(236, 231, 223), font=f18)
        for ci, (tr, tag) in enumerate(cols):
            dr.text((lab_w + ci * tw + 6, 22), f'{tr} {tag}', fill=(150, 150, 150), font=f14)
        for ri, p in enumerate(rows):
            y = 40 + ri * th
            dr.text((10, y + th // 2 - 24), p['name'], fill=(236, 231, 223), font=f14)
            swatches(dr, 10, y + th // 2, p['resolved'], 14)
            for ci, (tr, tag) in enumerate(cols):
                fp = os.path.join(frames, combo['id'], safe(p['name']), f'{tr}-{tag}.png')
                if os.path.exists(fp):
                    img.paste(Image.open(fp).convert('RGB').resize(THUMB, Image.LANCZOS), (lab_w + ci * tw, y))
        img.save(os.path.join(out, f"style-{combo['id']}.jpg"), quality=86)
    # Overview: palettes × combos, one drop frame each.
    sw, sh = 192, 108
    tr = idx['tracks'][0]
    img = Image.new('RGB', (150 + sw * len(idx['combos']), 30 + sh * len(idx['palettes'])), (12, 12, 14))
    dr = ImageDraw.Draw(img)
    for ci, combo in enumerate(idx['combos']):
        dr.text((150 + ci * sw + 4, 8), combo['id'][:24], fill=(150, 150, 150), font=font(11))
    for ri, p in enumerate(idx['palettes']):
        dr.text((8, 30 + ri * sh + sh // 2 - 8), p['name'][:18], fill=(236, 231, 223), font=f14)
        for ci, combo in enumerate(idx['combos']):
            fp = os.path.join(frames, combo['id'], safe(p['name']), f'{tr}-drop1.png')
            if os.path.exists(fp):
                img.paste(Image.open(fp).convert('RGB').resize((sw, sh), Image.LANCZOS), (150 + ci * sw, 30 + ri * sh))
    img.save(os.path.join(out, 'overview.jpg'), quality=86)


def compare(a_path, b_path):
    a, b = json.load(open(a_path)), json.load(open(b_path))
    for c in b['combos']:
        for p, mb in b['combos'][c].items():
            ma = a['combos'].get(c, {}).get(p)
            if not ma:
                continue
            print(f"{c:24s} {p:16s} chroma {ma['chroma']:.3f}→{mb['chroma']:.3f}  grey {ma['grey']*100:4.0f}→{mb['grey']*100:4.0f}%  off {ma['off']*100:3.0f}→{mb['off']*100:3.0f}%  L {ma['L']:.2f}→{mb['L']:.2f}  Lall {ma['Lall']:.3f}→{mb['Lall']:.3f}")


# ── Calibration and gates ───────────────────────────────────────
# Good references: the palettes Abdul loves. Neon is left out in Voyage: its
# secondary sits 133 deg from its primary and the stone mix greys it exactly
# like Aurora (measured: 44-48% grey vs Ocean/Crimson/Violet 2-20%).
GOOD = ['Ocean', 'Neon', 'Crimson', 'Violet']
DEFAULT = 'Ocean'
EXPO_TOL = {'L': 0.07, 'Lall': 0.07}   # widest loved palette vs Ocean: Neon in Voyage City, +0.06
AB_MIN = 10.0                          # Ink A vs B dE x100: loved minimum is Violet, 11.7


def good_for(combo):
    return [g for g in GOOD if not (combo.startswith('voyage') and g == 'Neon')]


def calibrate(base_path, out_path):
    b = json.load(open(base_path))
    th = {'_note': 'calibrated on the baseline (pre-overhaul palettes); see DOCS/SPRINT-LOG.md', 'combos': {}}
    for c, ps in b['combos'].items():
        g = [ps[x] for x in good_for(c) if x in ps]
        th['combos'][c] = {
            'chroma_min': round(0.85 * min(m['chroma'] for m in g), 4),
            'grey_max': round(min(1.0, max(m['grey'] for m in g) + 0.10), 3),
            'off_max': round(max(m['off'] for m in g) + 0.10, 3),
            'olive_max': round(max(m['olive'] for m in g) + 0.05, 3),
            'sep_min': round(0.8 * min(m['sep'] for m in g), 1),
        }
    th['expo_tol'] = EXPO_TOL
    th['ab_min'] = AB_MIN
    json.dump(th, open(out_path, 'w'), indent=1)
    print(f'thresholds -> {out_path}')


def gate(metrics_path, th_path, quiet=False):
    m, th = json.load(open(metrics_path)), json.load(open(th_path))
    fails = {}
    for c, ps in m['combos'].items():
        t = th['combos'].get(c)
        if not t:
            continue
        ref = ps.get(DEFAULT)
        for p, x in ps.items():
            f = []
            if x['chroma'] < t['chroma_min']: f.append(f"chroma {x['chroma']:.3f}<{t['chroma_min']:.3f}")
            if x['grey'] > t['grey_max']: f.append(f"grey {x['grey']:.0%}>{t['grey_max']:.0%}")
            if x['off'] > t['off_max']: f.append(f"off {x['off']:.0%}>{t['off_max']:.0%}")
            if x['olive'] > t['olive_max']: f.append(f"olive {x['olive']:.0%}>{t['olive_max']:.0%}")
            if x['sep'] < t['sep_min']: f.append(f"sep {x['sep']:.0f}<{t['sep_min']:.0f}")
            if ref:
                for k, tol in th['expo_tol'].items():
                    if abs(x[k] - ref[k]) > tol: f.append(f"{k} {x[k]:.2f} vs {DEFAULT} {ref[k]:.2f}")
            if c.startswith('ink-glow') or c.startswith('ink-marble'):
                ab = m['palettes'][p]['dE_A_B']
                if ab < th['ab_min']: f.append(f'A-B dE {ab:.1f}<{th["ab_min"]}')
            if f:
                fails.setdefault(p, []).append((c, f))
    pals = list(m['palettes'])
    for p in pals:
        fl = fails.get(p, [])
        print(f"{p:18s} {'PASS' if not fl else 'FAIL in %d combos' % len(fl)}")
        if not quiet:
            for c, f in fl:
                print(f"    {c:24s} {'; '.join(f)}")
    return fails


if __name__ == '__main__':
    if sys.argv[1] == 'calibrate':
        calibrate(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'gate':
        gate(sys.argv[2], sys.argv[3], '--quiet' in sys.argv)
    elif sys.argv[1] == 'compare':
        compare(sys.argv[2], sys.argv[3])
    else:
        run(sys.argv[1], sys.argv[2], '--no-sheets' not in sys.argv)
