/**
 * Voyage City's textures (sources and licences: ASSETS.md): two texture arrays,
 * loaded on first use of the City backdrop only (never by the site's shader
 * prewarm), transcoded in a worker from KTX2 (Basis) to the best compressed
 * format the GPU offers (BC7, ASTC, ETC2, BC3, else plain RGBA), with the full
 * mip chain and anisotropic filtering.
 *
 *   u_detail (sampler2DArray, tiled materials): 0 grass, 1 soil, 2 rock, 3 snow, 4 sand, 5 asphalt, 6 forest floor
 *   u_aerial (sampler2DArray, NAIP aerial imagery, A = vegetation height): 0-2 farmland, 3 shore, 4 forest, 5 town
 */

import wasmUrl from './basis/basis_transcoder.wasm?url';
import grass from '../../assets/voyage/d-grass.ktx2?url';
import soil from '../../assets/voyage/d-soil.ktx2?url';
import rock from '../../assets/voyage/d-rock.ktx2?url';
import snow from '../../assets/voyage/d-snow.ktx2?url';
import sand from '../../assets/voyage/d-sand.ktx2?url';
import asphalt from '../../assets/voyage/d-asphalt.ktx2?url';
import floor from '../../assets/voyage/d-forestfloor.ktx2?url';
import farm1 from '../../assets/voyage/a-farm1.ktx2?url';
import farm2 from '../../assets/voyage/a-farm2.ktx2?url';
import farm3 from '../../assets/voyage/a-farm3.ktx2?url';
import shore from '../../assets/voyage/a-shore.ktx2?url';
import forest from '../../assets/voyage/a-forest.ktx2?url';
import town from '../../assets/voyage/a-town.ktx2?url';

/** Anisotropic filtering (taps). */
const ANISOTROPY = 8;

export const DETAIL_LAYERS = [grass, soil, rock, snow, sand, asphalt, floor];
export const AERIAL_LAYERS = [farm1, farm2, farm3, shore, forest, town];

export interface VoyageTextures { detail: WebGLTexture; aerial: WebGLTexture; format: string }

// Basis transcoder target formats and the matching WebGL internal formats (sRGB).
const TARGETS: { ext: string; basis: number; gl: number; name: string }[] = [
  { ext: 'EXT_texture_compression_bptc', basis: 6, gl: 0x8e8d, name: 'bc7' },
  { ext: 'WEBGL_compressed_texture_astc', basis: 10, gl: 0x93d0, name: 'astc' },
  { ext: 'WEBGL_compressed_texture_etc', basis: 1, gl: 0x9279, name: 'etc2' },
  { ext: 'WEBGL_compressed_texture_s3tc_srgb', basis: 3, gl: 0x8c4f, name: 'bc3' },
];
const RGBA32 = 13;

let pending: Promise<VoyageTextures> | null = null;
let pendingGl: WebGL2RenderingContext | null = null;

/** Load once per GL context. */
export function loadVoyageTextures(gl: WebGL2RenderingContext): Promise<VoyageTextures> {
  if (pending && pendingGl === gl) return pending;
  pendingGl = gl;
  pending = load(gl);
  return pending;
}

async function load(gl: WebGL2RenderingContext): Promise<VoyageTextures> {
  const target = TARGETS.find((t) => gl.getExtension(t.ext)) ?? null;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const urls = [...DETAIL_LAYERS, ...AERIAL_LAYERS];
  const [wasm, ...data] = await Promise.all([wasmUrl, ...urls].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.arrayBuffer(); })));
  const got = new Map<string, { w: number; h: number; data: Uint8Array }[]>();
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./ktx2.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: string; name?: string; levels?: { w: number; h: number; data: Uint8Array }[]; message?: string }>) => {
      const m = e.data;
      if (m.type === 'file' && m.name && m.levels) got.set(m.name, m.levels);
      else if (m.type === 'done') { worker.terminate(); resolve(); } else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ wasm, format: target ? target.basis : RGBA32, files: urls.map((u, i) => ({ name: u, data: data[i] })) }, [wasm, ...data]);
  });
  const make = (list: string[]): WebGLTexture => {
    const first = got.get(list[0])!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, first.length, target ? target.gl : gl.SRGB8_ALPHA8, first[0].w, first[0].h, list.length);
    list.forEach((u, layer) => {
      const levels = got.get(u)!;
      levels.forEach((lv, l) => {
        if (target) gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, layer, lv.w, lv.h, 1, target.gl, lv.data);
        else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, layer, lv.w, lv.h, 1, gl.RGBA, gl.UNSIGNED_BYTE, lv.data);
      });
    });
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(ANISOTROPY, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return tex;
  };
  return { detail: make(DETAIL_LAYERS), aerial: make(AERIAL_LAYERS), format: target?.name ?? 'rgba8' };
}
