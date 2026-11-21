#!/usr/bin/env bash
# Album colours: after a palette-rule change, re-extract the test set, re-render
# only the palettes that changed (frames for unchanged ones are kept), re-run the
# colour metrics and gate, then the flicker gates (unchanged palettes' results kept).
set -u
cd "$(dirname "$0")/.."
FR=${PALETTE_FRAMES:-C:/Users/abdul/sonora-palette-frames}
cp verify/album/set.json verify/album/set-prev.json
node scripts/album-set.mjs > verify/album/extract.log 2>&1
python - "$FR/album" <<'PY'
import json,sys,os,shutil
old={p['name']:p['resolved'] for p in json.load(open('verify/album/set-prev.json'))}
new={p['name']:p['resolved'] for p in json.load(open('verify/album/set.json'))}
changed=[n for n in new if n not in old or any(abs(a-b)>1e-6 for k in new[n] for a,b in zip(new[n][k],old[n].get(k,[9,9,9])))]
print('changed palettes:',len(changed),changed)
root=sys.argv[1]
for combo in os.listdir(root) if os.path.isdir(root) else []:
    for n in changed:
        d=os.path.join(root,combo,n)
        if os.path.isdir(d): shutil.rmtree(d)
f='verify/palettes/album/flicker.json'
if os.path.exists(f):
    r=json.load(open(f))
    for c in r: [r[c].pop(n,None) for n in changed]
    json.dump(r,open(f,'w'),indent=1)
PY
PALETTE_PORT=5203 PALETTE_FRAMES=$FR node scripts/palette-matrix.mjs --name album --set verify/album/set.json --jobs 2
python scripts/palette-metrics.py gate verify/palettes/album/metrics.json scripts/palette-thresholds.json > verify/album/gate.log 2>&1
echo "colour gate: $(grep -c 'PASS$' verify/album/gate.log) pass"; grep -v 'PASS$' verify/album/gate.log
PALETTE_PORT=5203 node scripts/palette-matrix.mjs --name album --set verify/album/set.json --flicker --jobs 2
