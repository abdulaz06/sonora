#!/usr/bin/env python3
"""Builds verify/review-1.1/index.html from the files in that folder (Night /
Bone, every file shown with its path). Numbers come from DOCS/SPRINT-LOG.md's
1.1 summary; this page only lays the evidence out.

  python scripts/review-page.py
"""
import html, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = os.path.join(ROOT, 'verify', 'review-1.1')
rel = lambda p: os.path.relpath(p, R).replace('\\', '/')
full = lambda p: 'verify/review-1.1/' + p


def fig(path, cap, kind='img'):
    p = html.escape(path)
    if kind == 'video':
        media = f'<video src="{p}" controls muted loop playsinline preload="metadata"></video>'
    else:
        media = f'<a href="{p}"><img src="{p}" loading="lazy" alt=""></a>'
    return f'<figure>{media}<figcaption>{html.escape(cap)}<code>{html.escape(full(path))}</code></figcaption></figure>'


def table(rows, head):
    th = ''.join(f'<th>{html.escape(h)}</th>' for h in head)
    tr = ''.join('<tr>' + ''.join(f'<td>{html.escape(str(c))}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'


def logblock(name):
    p = os.path.join(R, name)
    if not os.path.exists(p):
        return ''
    return f'<details><summary><code>{full(name)}</code></summary><pre>{html.escape(open(p, encoding="utf8").read())}</pre></details>'


sections = []
sections.append(('try it', f'''
<ul>
<li><b>Export</b> (menu › Export, tray, <kbd>E</kbd>): a real song with embedded artwork; part and whole track; single style, styles tour, beat switch, showcase; 9:16 with safe zones and 16:9; title card, text lines, now playing; outro on and off; Best once; Cancel; Open folder.</li>
<li><b>Record</b> with Spotify: <kbd>F9</kbd>, HUD, tray or the controller; Settings › Recording. Sync was measured through the development fake capture; real system audio is yours to try.</li>
<li><b>Voyage City and Ocean</b> in several palettes and qualities; the wide shots come in breakdowns.</li>
</ul>'''))

sections.append(('export and recording', table([
    ['encoders', 'WebCodecs H.264 (hardware) + Windows Media Foundation AAC from Rust; mp4-muxer (MIT); no ffmpeg (D86)'],
    ['render speed 1080p60', 'Ink Glow Depth 51 fps incl. warm-up (0.85× real time); Voyage Void 30 fps; supersampled samples 15.2 / 6.4 fps'],
    ['determinism', 'identical frames over repeated renders (Voyage City 3/3, Silk Depth 5/5)'],
    ['A/V sync, export', '39/39 clicks within one frame (−16.5 … 0 ms)'],
    ['A/V sync, recording', '30/30 clicks within one frame (−16.9 … +16.5 ms)'],
    ['pacing, recording on', '0 held frames at 180 Hz, worst 5.8 ms (same as off); 0.19 ms CPU per recorded frame'],
    ['installer', 'NSIS 17.6 → 29.6 MB (+12.0): Voyage textures + transcoder 10.4 MB; everything else ≤ 1.65 MB'],
], ['measurement', 'result']) + '<div class="grid">' +
    fig('exports/portrait.mp4', '9:16 tour, album colours from the embedded cover, cinematic title, now-playing card, text line, outro', 'video') +
    fig('exports/landscape.mp4', '16:9 Voyage City, album colours, reel title, outro off', 'video') + '</div>'))

shots = sorted(f for f in os.listdir(os.path.join(R, 'export-screen')) if f.endswith('.png'))
sections.append(('export screen', '<div class="grid">' + ''.join(fig('export-screen/' + f, f.replace('.png', '').replace('-', ' ')) for f in shots) + '</div>'))

v = 'voyage/'
sections.append(('voyage city and ocean', table([
    ['City Low', '1.4–1.9', '1.7–3.2'], ['City Medium', '2.8–3.6', '4.4–4.8'], ['City High', '9.2–12.8', '10.7–12.7'],
    ['Ocean Low', '1.7–2.0', '2.7'], ['Ocean Medium', '3.7–4.2', '5.8–6.4'], ['Ocean High', '10.5–13.1', '12.5–14.9'],
    ['shader compile (cold, median)', '4.4 s', '4.0 s'],
], ['1080p frame time (ms)', '1.0.2', '1.1']) +
    '<p>Textures 9.9 MB (KTX2), loaded only when City shows. Licences: <a href="ASSETS.md"><code>verify/review-1.1/ASSETS.md</code></a> (also <code>ASSETS.md</code> at the repo root).</p>'
    '<div class="grid two">' +
    fig(v + 'media-voyage-city-before.webp', 'City thumbnail, 1.0.2') + fig(v + 'media-voyage-city-after.webp', 'City thumbnail, 1.1') +
    fig(v + 'media-voyage-ocean-before.webp', 'Ocean thumbnail, 1.0.2') + fig(v + 'media-voyage-ocean-after.webp', 'Ocean thumbnail, 1.1') +
    fig(v + 'city-clip-before.mp4', 'City wide shot, 1.0.2', 'video') + fig(v + 'city-clip-after.mp4', 'City wide shot, 1.1', 'video') +
    fig(v + 'ocean-clip-before.mp4', 'Ocean wide shot, 1.0.2', 'video') + fig(v + 'ocean-clip-after.mp4', 'Ocean wide shot, 1.1', 'video') +
    fig(v + 'city-wide-before-after.jpg', 'City wide shot, every palette: before | after') + fig(v + 'ocean-wide-before-after.jpg', 'Ocean wide shot, every palette: before | after') +
    fig(v + 'city-before-sheet.jpg', 'City 1.0.2: 5 palettes × 20 / 62 / 92 s') + fig(v + 'city-after-sheet.jpg', 'City 1.1: 5 palettes × 20 / 62 / 92 s') +
    fig(v + 'ocean-before-sheet.jpg', 'Ocean 1.0.2') + fig(v + 'ocean-after-sheet.jpg', 'Ocean 1.1') +
    (fig(v + 'palette-matrix-overview.jpg', 'palette matrix, City and Ocean, all nine palettes') if os.path.exists(os.path.join(R, v + 'palette-matrix-overview.jpg')) else '') +
    '</div>'))

sections.append(('/live lighthouse', table([
    ['/live desktop', '47', '95'], ['/live mobile', '100', '100'], ['landing desktop', '100', '100'], ['landing mobile', '99', '99'],
], ['page', '1.0.2', '1.1']) + '<p><code>test:live</code> 321 / 321, including Export and Record staying off the web.</p>'))

sections.append(('gates, before → after', table([
    ['Ink look and motion', 'identical to 1.0.2 (Glow Depth, Marble Depth, Sumi Flat, 120/120 frames)'],
    ['Warp', 'identical'],
    ['Silk Depth, Wisp Tunnel', 'identical with 1.1; differ in main because of the 1.2 session\'s Helix commit (see below)'],
    ['beat sync', 'Voyage City / Ocean 23/23 kicks, both tracks (as 1.0.2)'],
    ['flicker', 'City / Ocean pass in every palette (≤ 0.75 swings/s, clip ≤ 0.5%)'],
    ['motion', 'Voyage equal to 1.0.2'],
    ['dt sweep', 'Ink Marble Depth PASS, numbers equal to 1.0.2'],
    ['pacing', '0 held frames, same as 1.0.2 run back to back'],
    ['palette gates', 'City / Ocean on the light: all nine pass'],
    ['tests', 'tsc, clippy clean; npm test 52 passed'],
], ['gate', 'result']) + logblock('identical.log') + logblock('identical-mine.log') + logblock('identical-prehelix.log') + logblock('voyage-gates.log')))

sections.append(('for your decision', '''<ul>
<li>Current <code>main</code> includes the 1.2 session's work (filters, Silk Helix, Stage; 1.2 styles hidden on the website only). Silk Depth and Wisp Tunnel render differently from 1.0.2 in main because of the Helix commit. Releasing 1.1.0 from main ships that work in the app; say if 1.1.0 should come from a branch without it.</li>
<li>Ocean's quieter palettes read close to each other in the wide shot (the palette is only in the sun, sky and glints, as asked); say if you want the light stronger.</li>
</ul>'''))

nav = ''.join(f'<a href="#s{i}">{html.escape(t)}</a>' for i, (t, _) in enumerate(sections))
body = ''.join(f'<section id="s{i}"><h2>{html.escape(t)}</h2>{c}</section>' for i, (t, c) in enumerate(sections))
page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonora 1.1 · review</title>
<style>
:root {{ --night:#08080A; --bone:#ECE7DF; }}
body {{ margin:0; background:var(--night); color:rgba(236,231,223,.78); font:15px/1.5 Inter, "Segoe UI", system-ui, sans-serif; }}
header {{ padding:32px 48px 16px; border-bottom:1px solid rgba(236,231,223,.12); position:sticky; top:0; background:var(--night); z-index:2; }}
h1 {{ margin:0 0 12px; color:var(--bone); font-weight:600; letter-spacing:-.02em; }}
nav a {{ font:500 11px/1 "IBM Plex Mono", Consolas, monospace; letter-spacing:.12em; text-transform:uppercase; color:rgba(236,231,223,.6); margin-right:18px; text-decoration:none; }}
nav a:hover {{ color:var(--bone); }}
section {{ padding:28px 48px; border-bottom:1px solid rgba(236,231,223,.12); }}
h2 {{ font:500 12px/1 "IBM Plex Mono", Consolas, monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--bone); margin:0 0 18px; }}
table {{ border-collapse:collapse; margin:0 0 18px; }}
td, th {{ border-top:1px solid rgba(236,231,223,.12); padding:7px 18px 7px 0; text-align:left; vertical-align:top; }}
th {{ font:500 11px "IBM Plex Mono", monospace; letter-spacing:.1em; text-transform:uppercase; color:rgba(236,231,223,.5); }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(420px, 1fr)); gap:18px; }}
.grid.two {{ grid-template-columns:repeat(2, 1fr); }}
figure {{ margin:0; }} img, video {{ width:100%; display:block; background:#000; outline:1px solid rgba(236,231,223,.12); }}
figcaption {{ font-size:13px; margin-top:6px; }} figcaption code {{ display:block; color:rgba(236,231,223,.45); font-size:11px; margin-top:2px; }}
code, pre {{ font-family:"IBM Plex Mono", Consolas, monospace; }} pre {{ white-space:pre-wrap; font-size:12px; }}
a {{ color:var(--bone); }} kbd {{ font:12px "IBM Plex Mono", monospace; border:1px solid rgba(236,231,223,.3); padding:0 4px; }}
</style></head><body><header><h1>sonora 1.1 — review</h1><nav>{nav}</nav></header>{body}</body></html>'''
open(os.path.join(R, 'index.html'), 'w', encoding='utf8').write(page)
print(os.path.join(R, 'index.html'))
