#!/usr/bin/env node
// Voyage world textures, step 2: the rasters from prep.py → KTX2 (Basis UASTC,
// Zstandard supercompression, full mip chain, sRGB) in src/assets/voyage/,
// encoded with ktx2-encoder (MIT; Basis Universal encoder as WebAssembly,
// Apache-2.0). Sources and licences: ASSETS.md.
//
//   python -I scripts/textures/prep.py && node scripts/textures/build.mjs [--quality 2]
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'local-media', 'textures-src', 'out');
const OUT = join(ROOT, 'src', 'assets', 'voyage');
mkdirSync(OUT, { recursive: true });
const q = (() => { const i = process.argv.indexOf('--quality'); return i > 0 ? Number(process.argv[i + 1]) : 2; })();
// Raw rasters: u32 width, u32 height, then RGBA bytes.
const imageDecoder = async (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = dv.getUint32(0, true), height = dv.getUint32(4, true);
  return { width, height, data: new Uint8Array(buf.buffer, buf.byteOffset + 8, width * height * 4) };
};
/** UASTC rate-distortion lambda (higher = smaller, softer). */
const RDO = Number(process.env.KTX_RDO || 2);
/** ETC1S quality (1-255). */
const ETC1S_QUALITY = Number(process.env.KTX_ETC1S || 200);
let total = 0;
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.rgba')).sort()) {
  const t0 = Date.now();
  // Aerial imagery (large, seen whole): UASTC with rate-distortion optimisation + Zstandard.
  // Detail materials (tiled, modulate procedural colour up close): ETC1S, much smaller.
  const aerial = f.startsWith('a-');
  const ktx = await encodeToKTX2(new Uint8Array(readFileSync(join(SRC, f))), aerial
    ? { isUASTC: true, uastcLDRQualityLevel: q, enableRDO: true, rdoQualityLevel: RDO, needSupercompression: true, generateMipmap: true, isKTX2File: true, isPerceptual: true, imageDecoder }
    : { isUASTC: false, qualityLevel: ETC1S_QUALITY, compressionLevel: 2, generateMipmap: true, isKTX2File: true, isPerceptual: true, imageDecoder });
  const out = join(OUT, f.replace('.rgba', '.ktx2'));
  writeFileSync(out, ktx);
  total += ktx.byteLength;
  console.log(`${f.replace('.rgba', '.ktx2')}: ${(ktx.byteLength / 1024).toFixed(0)} KB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
console.log(`total ${(total / 1048576).toFixed(2)} MB → ${OUT}`);
void statSync;
