/**
 * Transcodes Voyage's KTX2 (Basis UASTC / ETC1S) textures to the GPU format the
 * page can use, off the main thread. Input: the transcoder's wasm bytes, the
 * target format and the files; output: every mip level of every file.
 */
import BASIS from './basis/basis_transcoder.mjs';

interface Job { wasm: ArrayBuffer; format: number; files: { name: string; data: ArrayBuffer }[] }
interface Ktx2File {
  isValid(): boolean; getWidth(): number; getHeight(): number; getLevels(): number;
  startTranscoding(): boolean; getImageLevelInfo(level: number, layer: number, face: number): { origWidth: number; origHeight: number };
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, fmt: number): number;
  transcodeImage(dst: Uint8Array, level: number, layer: number, face: number, fmt: number, flags: number, ch0: number, ch1: number): boolean;
  close(): void; delete(): void;
}
interface BasisModule { initializeBasis(): void; KTX2File: new (d: Uint8Array) => Ktx2File }

self.onmessage = async (e: MessageEvent<Job>) => {
  const { wasm, format, files } = e.data;
  try {
    const mod = await (BASIS as unknown as (o: { wasmBinary: ArrayBuffer }) => Promise<BasisModule>)({ wasmBinary: wasm });
    mod.initializeBasis();
    for (const f of files) {
      const k = new mod.KTX2File(new Uint8Array(f.data));
      if (!k.isValid() || !k.startTranscoding()) { k.close(); k.delete(); throw new Error(`bad ktx2: ${f.name}`); }
      const levels: { w: number; h: number; data: Uint8Array }[] = [];
      for (let l = 0; l < k.getLevels(); l++) {
        const info = k.getImageLevelInfo(l, 0, 0);
        const dst = new Uint8Array(k.getImageTranscodedSizeInBytes(l, 0, 0, format));
        if (!k.transcodeImage(dst, l, 0, 0, format, 0, -1, -1)) throw new Error(`transcode failed: ${f.name} level ${l}`);
        levels.push({ w: info.origWidth, h: info.origHeight, data: dst });
      }
      k.close(); k.delete();
      (self as unknown as Worker).postMessage({ type: 'file', name: f.name, levels }, levels.map((x) => x.data.buffer));
    }
    (self as unknown as Worker).postMessage({ type: 'done' });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
  }
};
