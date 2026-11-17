"""Encode media/ masters and loop frames into the shipped assets.

python scripts/media-encode.py sheets <names…>   contact sheets → media/sheets/<name>.jpg
python scripts/media-encode.py encode <names…>   → src/assets/media/<name>-<w>.webp, <name>.webm, manifest.json

Called by scripts/media.mjs (see there). Loops are blended over their start for
a seamless repeat and encoded VP9 (muted) with ffmpeg-static.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.environ.get("SONORA_MEDIA_DIR") or os.path.join(ROOT, "media")
OUT = os.path.join(ROOT, "src", "assets", "media")
FFMPEG = os.path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
FPS = 30
SEAM_S = 0.6
LOOP_CRF = 38
LOOP_W, LOOP_H = 1024, 576
LOOP_MAX_BYTES = 1_350_000


def plan():
    """Read the plan from the .mjs via node so there is one source of truth."""
    js = "import('./scripts/media-plan.mjs').then(m => console.log(JSON.stringify(m.PLAN.map(m.withDefaults))))"
    out = subprocess.check_output(["node", "--input-type=module", "-e", js], cwd=ROOT)
    return {e["name"]: e for e in json.loads(out)}


def sheets(names):
    os.makedirs(os.path.join(MEDIA, "sheets"), exist_ok=True)
    for name in names:
        d = os.path.join(MEDIA, "candidates", name)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
        if not files:
            continue
        cols = min(4, len(files))
        rows = (len(files) + cols - 1) // cols
        tw, th = 480, 270
        sheet = Image.new("RGB", (cols * tw + (cols + 1) * 8, rows * (th + 22) + 8), (8, 8, 10))
        dr = ImageDraw.Draw(sheet)
        for i, f in enumerate(files):
            im = Image.open(os.path.join(d, f)).convert("RGB").resize((tw, th), Image.LANCZOS)
            x = 8 + (i % cols) * (tw + 8)
            y = 8 + (i // cols) * (th + 22)
            sheet.paste(im, (x, y))
            dr.text((x, y + th + 4), f"{name}  t={float(f[:-4]):g}", fill=(236, 231, 223))
        dst = os.path.join(MEDIA, "sheets", f"{name}.jpg")
        sheet.save(dst, quality=88)
        print(dst)


def encode_loop(name, e):
    d = os.path.join(MEDIA, "frames", name)
    files = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
    seam = int(round(SEAM_S * FPS))
    n = len(files) - seam
    if n <= seam:
        raise SystemExit(f"{name}: not enough loop frames")
    # Both sides multiples of 16: some hardware VP9 decoders show their
    # padding rows (a green stripe) on 960x540.
    width, height = (768, 432) if e["kind"] == "explain" else (LOOP_W, LOOP_H)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            im = Image.open(os.path.join(d, files[i])).convert("RGB")
            if i < seam:
                # Blend the frames rendered after the end over the start: the
                # last frame flows straight into the first.
                tail = Image.open(os.path.join(d, files[n + i])).convert("RGB")
                a = (i + 0.5) / seam
                im = Image.blend(tail, im, a * a * (3 - 2 * a))
            if im.width != width:
                im = im.resize((width, height), Image.LANCZOS)
            im.save(os.path.join(tmp, f"{i:04d}.png"))
        dst = os.path.join(OUT, f"{name}.webm")
        src = os.path.join(tmp, "%04d.png")

        def run(rate):
            subprocess.check_call([
                FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", src,
                "-c:v", "libvpx-vp9", "-b:v", rate, "-crf", str(LOOP_CRF), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
                "-pix_fmt", "yuv420p", "-an", dst,
            ])
        run("0")
        # Dense loops (Warp's stars, Marble's grain) blow up at constant quality:
        # cap them to the per-loop budget (constrained quality).
        if os.path.getsize(dst) > LOOP_MAX_BYTES:
            seconds = n / FPS
            run(f"{int(LOOP_MAX_BYTES * 8 * 0.86 / seconds / 1000)}k")
    return dst


def encode(names):
    entries = plan()
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f).get("assets", {})
    for name in names:
        e = entries[name]
        master = os.path.join(MEDIA, "masters", f"{name}.png")
        if not os.path.exists(master):
            print(f"missing master {master}")
            continue
        im = Image.open(master).convert("RGB")
        stills = {}
        for w in e["sizes"]:
            h = w * 9 // 16
            dst = os.path.join(OUT, f"{name}-{w}.webp")
            im.resize((w, h), Image.LANCZOS).save(dst, "WEBP", quality=84 if w >= 1000 else 80, method=6)
            stills[str(w)] = os.path.basename(dst)
        loop = None
        if e["loop"] > 0:
            loop = os.path.basename(encode_loop(name, e))
        entry = {
            "kind": e["kind"], "style": e["style"], "look": e.get("look"), "view": None if e.get("depth") is None else ("depth" if e["depth"] else "flat"),
            "stills": stills, "loop": loop, "loopSeconds": e["loop"] or None,
            "source": {"track": e["track"], "time": e["pick"], "palette": e["palette"], "light": e["light"], "camera": e.get("camera"),
                       "quality": e["quality"], "responsiveness": e["resp"]},
        }
        manifest[name] = entry
        sizes = ", ".join(f"{os.path.getsize(os.path.join(OUT, s)) // 1024} KB" for s in stills.values())
        print(f"{name}: {sizes}{f', loop {os.path.getsize(os.path.join(OUT, loop)) // 1024} KB' if loop else ''}")
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"note": "Generated by `npm run media` (scripts/media.mjs). Masters: media/ (git-ignored).",
                   "assets": dict(sorted(manifest.items()))}, f, indent=1)
    print(f"total shipped media: {total / 1e6:.2f} MB")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    if cmd == "sheets":
        sheets(rest)
    elif cmd == "encode":
        encode(rest)
    else:
        raise SystemExit(f"unknown command {cmd}")
