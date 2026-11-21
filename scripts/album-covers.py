"""Synthetic album covers for the album-colours test set (A2.5).

    python scripts/album-covers.py [out_dir]     (default local-media/covers/test, git-ignored)

Writes ~50 600x600 JPEGs across the cases album colours must survive: vivid
shapes, pastels, single-hue (mono) covers, two-tones, gradients, busy
photo-like noise, near-black and near-white covers with small colour, black
and white, sepia, and the hard hues (olive, cyan, yellow). Procedural, so
they can be regenerated any time; real covers stay in local-media/covers/.
"""
import colorsys
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

N = 600
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'local-media', 'covers', 'test')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def hsv(h, s, v):
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, s, v)
    return (int(r * 255), int(g * 255), int(b * 255))


def save(name, img):
    img.convert('RGB').save(os.path.join(OUT, f'{name}.jpg'), quality=90)


def font(size):
    for f in ('C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def text(d, xy, s, fill, size=54):
    d.text(xy, s, fill=fill, font=font(size))


def noise(scale, octaves=4, seed=0):
    """Smooth value noise in 0..1 (sum of upsampled random grids)."""
    g = np.random.default_rng(seed)
    acc = np.zeros((N, N))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        k = max(2, int(scale * 2 ** o))
        small = g.random((k, k))
        up = np.array(Image.fromarray((small * 255).astype(np.uint8)).resize((N, N), Image.BICUBIC)) / 255.0
        acc += amp * up
        tot += amp
        amp *= 0.5
    return acc / tot


def field(fn):
    y, x = np.mgrid[0:N, 0:N] / N
    return Image.fromarray(np.clip(fn(x, y), 0, 255).astype(np.uint8))


def lerp_img(c0, c1, t):
    c0, c1 = np.array(c0, float), np.array(c1, float)
    return (c0[None, None, :] * (1 - t[..., None]) + c1[None, None, :] * t[..., None])


# ── 1. Vivid shapes on dark / coloured grounds ──────────────────
for i, (h, name) in enumerate([(0, 'red'), (28, 'orange'), (48, 'gold'), (125, 'green'), (175, 'teal'), (215, 'blue'), (270, 'purple'), (315, 'magenta')]):
    img = Image.new('RGB', (N, N), hsv(h, 0.55, 0.18))
    d = ImageDraw.Draw(img)
    d.ellipse((120, 120, 480, 480), fill=hsv(h, 0.92, 0.95))
    d.rectangle((60, 470, 540, 520), fill=hsv(h + 20, 0.8, 0.85))
    text(d, (60, 40), name.upper(), (240, 236, 228))
    save(f'vivid-{i:02d}-{name}', img)

# ── 2. Pastels ──────────────────────────────────────────────────
for i, hs in enumerate([(340, 20), (200, 160), (90, 50), (270, 330), (30, 180)]):
    img = Image.new('RGB', (N, N), hsv(hs[0], 0.18, 0.96))
    d = ImageDraw.Draw(img)
    for k in range(5):
        r = 90 + k * 40
        d.ellipse((300 - r, 300 - r, 300 + r, 300 + r), outline=hsv(hs[k % 2], 0.32, 0.92), width=18)
    text(d, (40, 520), 'soft', hsv(hs[1], 0.35, 0.7), 44)
    save(f'pastel-{i:02d}', img)

# ── 3. Mono: one hue in light and shade (a photo of a single-colour scene) ──
for i, h in enumerate([210, 0, 150, 285, 35]):
    n = noise(3, 5, seed=10 + i)
    arr = lerp_img(hsv(h, 0.85, 0.12), hsv(h, 0.6, 0.95), n)
    save(f'mono-{i:02d}-h{h}', Image.fromarray(arr.astype(np.uint8)))

# ── 4. Two-tone ─────────────────────────────────────────────────
pairs = [(0, 210), (30, 270), (330, 160), (60, 250), (190, 20), (300, 120)]
for i, (a, b) in enumerate(pairs):
    img = Image.new('RGB', (N, N), hsv(a, 0.9, 0.85))
    d = ImageDraw.Draw(img)
    d.polygon([(N, 0), (N, N), (0, N)], fill=hsv(b, 0.85, 0.7))
    text(d, (40, 40), 'TWO', (250, 250, 250))
    save(f'twotone-{i:02d}-{a}-{b}', img)

# ── 5. Gradients ────────────────────────────────────────────────
grads = [((250, 0.9, 0.9), (320, 0.9, 0.95)), ((10, 0.95, 0.95), (45, 0.9, 1.0)), ((160, 0.9, 0.7), (220, 0.9, 0.9)),
         ((280, 0.8, 0.3), (20, 0.9, 1.0)), ((200, 0.7, 0.2), (200, 0.4, 0.95))]
for i, (c0, c1) in enumerate(grads):
    y = np.mgrid[0:N, 0:N][0] / N
    arr = lerp_img(hsv(*c0), hsv(*c1), y)
    save(f'gradient-{i:02d}', Image.fromarray(arr.astype(np.uint8)))
# Sunset: several hues top to bottom.
y = np.mgrid[0:N, 0:N][0] / N
stops = [hsv(260, 0.8, 0.35), hsv(320, 0.8, 0.75), hsv(15, 0.9, 1.0), hsv(40, 0.9, 1.0)]
seg = np.clip(y * 3, 0, 2.999)
k = seg.astype(int)
t = seg - k
arr = np.zeros((N, N, 3))
for j in range(3):
    m = k == j
    arr[m] = lerp_img(stops[j], stops[j + 1], t)[m]
save('gradient-05-sunset', Image.fromarray(arr.astype(np.uint8)))

# ── 6. Busy, photo-like ─────────────────────────────────────────
for i in range(6):
    n1, n2, n3 = noise(4, 5, 30 + i), noise(9, 4, 40 + i), noise(2, 3, 50 + i)
    hbase = [20, 200, 120, 300, 40, 260][i]
    h = (hbase + 120 * n2 - 60) % 360
    s = 0.35 + 0.55 * n3
    v = 0.15 + 0.85 * n1
    rgb = np.zeros((N, N, 3))
    hh, ss, vv = h / 360, s, v
    i6 = np.floor(hh * 6).astype(int) % 6
    f = hh * 6 - np.floor(hh * 6)
    p, q, t2 = vv * (1 - ss), vv * (1 - f * ss), vv * (1 - (1 - f) * ss)
    for k6, (r, g, b) in enumerate([(vv, t2, p), (q, vv, p), (p, vv, t2), (p, q, vv), (t2, p, vv), (vv, p, q)]):
        m = i6 == k6
        rgb[m, 0], rgb[m, 1], rgb[m, 2] = r[m], g[m], b[m]
    img = Image.fromarray((rgb * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    # Bokeh lights.
    d = ImageDraw.Draw(img, 'RGBA')
    for _ in range(40):
        x, yy, r = rng.integers(0, N), rng.integers(0, N), rng.integers(8, 40)
        d.ellipse((x - r, yy - r, x + r, yy + r), fill=hsv(hbase + rng.integers(-40, 40), 0.5, 1.0) + (70,))
    save(f'busy-{i:02d}', img)

# ── 7. Near-black ───────────────────────────────────────────────
img = Image.new('RGB', (N, N), (6, 6, 8)); d = ImageDraw.Draw(img)
d.ellipse((250, 250, 350, 350), fill=hsv(0, 0.95, 0.9)); save('black-00-red-dot', img)
img = Image.new('RGB', (N, N), (10, 10, 12)); d = ImageDraw.Draw(img)
text(d, (60, 260), 'NOCTURNE', (236, 232, 225), 70); save('black-01-white-type', img)
img = Image.new('RGB', (N, N), (12, 8, 22)); d = ImageDraw.Draw(img)
d.line((0, 420, N, 380), fill=hsv(190, 0.9, 0.95), width=10); save('black-02-cyan-line', img)
arr = lerp_img((4, 4, 6), (30, 14, 40), noise(2, 3, 60)); save('black-03-dim-violet', Image.fromarray(arr.astype(np.uint8)))

# ── 8. Near-white ───────────────────────────────────────────────
img = Image.new('RGB', (N, N), (246, 244, 240)); d = ImageDraw.Draw(img)
d.rectangle((80, 260, 520, 330), fill=hsv(220, 0.9, 0.85)); save('white-00-blue-band', img)
img = Image.new('RGB', (N, N), (250, 250, 250)); d = ImageDraw.Draw(img)
text(d, (80, 270), 'minimal', (20, 20, 20), 64); save('white-01-black-type', img)
img = Image.new('RGB', (N, N), (240, 238, 232)); d = ImageDraw.Draw(img)
d.ellipse((200, 200, 400, 400), fill=hsv(15, 0.85, 0.95)); d.ellipse((260, 260, 340, 340), fill=hsv(350, 0.9, 0.7)); save('white-02-orange-sun', img)

# ── 9. Black and white ──────────────────────────────────────────
n = noise(3, 6, 70)
save('bw-00-photo', Image.fromarray((40 + 200 * n).astype(np.uint8)).convert('RGB'))
img = Image.new('RGB', (N, N), (0, 0, 0)); d = ImageDraw.Draw(img); d.rectangle((300, 0, N, N), fill=(255, 255, 255)); save('bw-01-halves', img)

# ── 10. Sepia / tinted ──────────────────────────────────────────
n = noise(3, 6, 80)
arr = lerp_img((40, 28, 18), (225, 205, 170), n); save('sepia-00', Image.fromarray(arr.astype(np.uint8)))
arr = lerp_img((10, 16, 34), (150, 165, 190), noise(3, 5, 81)); save('tint-01-steel-blue', Image.fromarray(arr.astype(np.uint8)))

# ── 11. The hard hues: olive, cyan, yellow ──────────────────────
arr = lerp_img(hsv(75, 0.8, 0.25), hsv(70, 0.7, 0.6), noise(3, 5, 90)); save('hard-00-olive', Image.fromarray(arr.astype(np.uint8)))
img = Image.new('RGB', (N, N), hsv(185, 0.85, 0.85)); d = ImageDraw.Draw(img); text(d, (40, 40), 'AQUA', (255, 255, 255), 80); save('hard-01-cyan', img)
img = Image.new('RGB', (N, N), hsv(56, 0.95, 1.0)); d = ImageDraw.Draw(img); d.rectangle((0, 400, N, N), fill=(20, 20, 20)); save('hard-02-yellow-black', img)
img = Image.new('RGB', (N, N), hsv(100, 0.9, 0.8)); d = ImageDraw.Draw(img); d.ellipse((150, 150, 450, 450), fill=hsv(320, 0.9, 0.9)); save('hard-03-lime-magenta', img)

print(len([f for f in os.listdir(OUT) if f.endswith('.jpg')]), 'covers in', os.path.abspath(OUT))
