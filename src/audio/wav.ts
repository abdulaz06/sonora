/** Parse a 16-bit PCM WAV to mono floats (exact, no resampling). */
export function decodeWavMono(buf: ArrayBuffer): { sampleRate: number; mono: Float32Array } | null {
  const v = new DataView(buf);
  const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let pos = 12, channels = 1, rate = 44100, bits = 16;
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (bits !== 16) return null;
      const frames = Math.floor(size / (2 * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += v.getInt16(body + (f * channels + c) * 2, true) / 32768;
        mono[f] = acc / channels;
      }
      return { sampleRate: rate, mono };
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}
