#!/usr/bin/env node
// Instagram-like re-encode check for a reel: re-encodes reel.mp4 the way
// Instagram serves reels (1080×1920, 30 fps, H.264 at ~3.5 Mbps VBV) and
// compares it with the master:
//   ssim / psnr     overall fidelity
//   banding         dark smooth areas that turn into flat steps (share of
//                   pixels with zero gradient in the copy where the master had
//                   a gentle gradient), per segment
//   flicker         fine-detail frame-to-frame change (high-pass), copy ÷ master:
//                   > 1 means compression adds shimmer
// Writes <reel dir>/ig-check/{ig.mp4, report.json} and prints a line per segment.
//   node scripts/reel/ig-check.mjs <reel.mp4> [--segments 0,4,8,12,16]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ffmpeg, ROOT } from './lib.mjs';

export const IG_ARGS = ['-vf', 'scale=1080:1920:flags=bicubic,fps=30', '-c:v', 'libx264', '-preset', 'faster', '-profile:v', 'high', '-b:v', '3500k', '-maxrate', '4500k', '-bufsize', '7000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];

export function igCheck(reel, segments = null) {
  const dir = join(dirname(reel), 'ig-check');
  mkdirSync(dir, { recursive: true });
  const ig = join(dir, 'ig.mp4');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', reel, ...IG_ARGS, ig]);
  // ffmpeg prints its measurements on stderr (and exits non-zero without an output file).
  const errOf = (args) => spawnSync(ffmpeg, args, { encoding: 'utf8' }).stderr ?? '';
  const measure = (filter) => errOf(['-hide_banner', '-i', ig, '-i', reel, '-lavfi', `[0:v]settb=1/30,setpts=N/30/TB[c];[1:v]fps=30,scale=1080:1920,settb=1/30,setpts=N/30/TB[r];[c][r]${filter}`, '-f', 'null', '-']);
  const ssim = Number(/All:([\d.]+)/.exec(measure('ssim'))?.[1] ?? NaN);
  const psnr = Number(/average:([\d.]+)/.exec(measure('psnr'))?.[1] ?? NaN);
  const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(errOf(['-hide_banner', '-i', reel]));
  const dur = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 20;
  const segs = segments ?? [0.25, 0.5, 0.75].map((f) => +(f * dur).toFixed(2));
  const frames = join(dir, 'frames');
  const report = { reel, ig, ssim, psnr, segments: [] };
  for (const t of segs) {
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(join(frames, 'm'), { recursive: true }); mkdirSync(join(frames, 'c'), { recursive: true });
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', reel, '-t', '1', '-vf', 'fps=30,scale=540:960:flags=area,format=gray', join(frames, 'm', 'f%03d.png')]);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', ig, '-t', '1', '-vf', 'scale=540:960:flags=area,format=gray', join(frames, 'c', 'f%03d.png')]);
    const py = `
import sys,glob,json
import numpy as np
from PIL import Image
def load(d): return [np.asarray(Image.open(f),dtype=np.float32) for f in sorted(glob.glob(d+'/f*.png'))]
M=load(sys.argv[1]); C=load(sys.argv[2]); n=min(len(M),len(C))
band=[];fl_m=[];fl_c=[]
def hp(a):
    b=(a[:-2,1:-1]+a[2:,1:-1]+a[1:-1,:-2]+a[1:-1,2:])/4
    return a[1:-1,1:-1]-b
for i in range(n):
    m,c=M[i],C[i]
    gm=np.abs(np.diff(m,axis=1))[:-1,:]+np.abs(np.diff(m,axis=0))[:,:-1]
    gc=np.abs(np.diff(c,axis=1))[:-1,:]+np.abs(np.diff(c,axis=0))[:,:-1]
    dark=(m[:-1,:-1]<70)&(gm>0.15)&(gm<3)
    if dark.sum()>500: band.append(float(((gc<0.5)&dark).sum()/dark.sum()))
    if i>0:
        fl_m.append(float(np.mean(np.abs(hp(m)-hp(M[i-1])))))
        fl_c.append(float(np.mean(np.abs(hp(c)-hp(C[i-1])))))
print(json.dumps({'banding': (sum(band)/len(band)) if band else None, 'flickerMaster': sum(fl_m)/max(1,len(fl_m)), 'flickerCopy': sum(fl_c)/max(1,len(fl_c))}))
`;
    const r = JSON.parse(execFileSync('python', ['-c', py, join(frames, 'm'), join(frames, 'c')], { encoding: 'utf8' }));
    r.t = t;
    r.flickerRatio = r.flickerMaster > 0 ? r.flickerCopy / r.flickerMaster : null;
    report.segments.push(r);
    console.log(`  t ${t.toFixed(1)} s: banding ${r.banding === null ? '–' : (100 * r.banding).toFixed(1) + '%'}, fine flicker ×${r.flickerRatio?.toFixed(2)}`);
  }
  rmSync(frames, { recursive: true, force: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`ig-check ${reel}: ssim ${ssim.toFixed(4)}, psnr ${psnr.toFixed(2)} dB → ${dir}`);
  return report;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/reel/ig-check.mjs')) {
  const reel = process.argv[2];
  const i = process.argv.indexOf('--segments');
  igCheck(reel, i > 0 ? process.argv[i + 1].split(',').map(Number) : null);
}
void ROOT;
