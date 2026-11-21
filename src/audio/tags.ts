/**
 * Title, artist, album and the embedded cover from an audio file, for the web
 * page's now playing and album colours: MP3 (ID3v2 APIC / PIC and text
 * frames), M4A / MP4 (iTunes `covr`, ©nam, ©ART, ©alb) and FLAC (PICTURE and
 * VORBIS_COMMENT blocks). Everything is read in the browser; nothing is sent.
 */

export interface FileTags {
  title?: string;
  artist?: string;
  album?: string;
  picture?: { mime: string; data: Uint8Array };
}

/** Covers bigger than this are ignored (bytes). */
const MAX_PICTURE = 8 * 1024 * 1024;

export function readTags(buf: ArrayBuffer): FileTags {
  const b = new Uint8Array(buf);
  try {
    if (b.length > 10 && str(b, 0, 3) === 'ID3') return readId3(b);
    if (b.length > 4 && str(b, 0, 4) === 'fLaC') return readFlac(b);
    if (b.length > 12 && str(b, 4, 4) === 'ftyp') return readMp4(b);
  } catch { /* a broken tag never stops playback */ }
  return {};
}

/** The picture as a data: URL ('' if none). */
export function pictureUrl(t: FileTags): string {
  if (!t.picture) return '';
  const { mime, data } = t.picture;
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${mime || sniff(data)};base64,${btoa(s)}`;
}

function sniff(d: Uint8Array): string {
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png';
  if (d[0] === 0x52 && d[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

const str = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));
const u32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u24 = (b: Uint8Array, o: number): number => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const syncsafe = (b: Uint8Array, o: number): number => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

/** ID3 text: encoding byte then the text (0 latin-1, 1 UTF-16 BOM, 2 UTF-16BE, 3 UTF-8). */
function id3Text(enc: number, d: Uint8Array): string {
  const label = enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'latin1';
  return new TextDecoder(label).decode(d).replace(/\0+$/, '').split('\0')[0].trim();
}

/** End of a null-terminated string in `enc` from `o` (2-byte nulls for UTF-16). */
function nulEnd(d: Uint8Array, o: number, enc: number): number {
  if (enc === 1 || enc === 2) { for (let i = o; i + 1 < d.length; i += 2) if (d[i] === 0 && d[i + 1] === 0) return i; return d.length; }
  for (let i = o; i < d.length; i++) if (d[i] === 0) return i;
  return d.length;
}

function readId3(b: Uint8Array): FileTags {
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  let o = 10;
  const end = Math.min(b.length, 10 + size);
  if (flags & 0x40) o += ver === 4 ? syncsafe(b, o) : u32(b, o) + 4;   // extended header
  const out: FileTags = {};
  let pic: { mime: string; data: Uint8Array; type: number } | null = null;
  while (o + (ver === 2 ? 6 : 10) <= end) {
    const id = str(b, o, ver === 2 ? 3 : 4);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = ver === 2 ? u24(b, o + 3) : ver === 4 ? syncsafe(b, o + 4) : u32(b, o + 4);
    const hdr = ver === 2 ? 6 : 10;
    const d = b.subarray(o + hdr, Math.min(end, o + hdr + len));
    o += hdr + len;
    if (!len) continue;
    if (id === 'TIT2' || id === 'TT2') out.title = id3Text(d[0], d.subarray(1));
    else if (id === 'TPE1' || id === 'TP1') out.artist = id3Text(d[0], d.subarray(1));
    else if (id === 'TALB' || id === 'TAL') out.album = id3Text(d[0], d.subarray(1));
    else if ((id === 'APIC' || id === 'PIC') && len < MAX_PICTURE) {
      const enc = d[0];
      let p = 1, mime: string;
      if (id === 'PIC') { mime = str(d, 1, 3).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'; p = 4; } else {
        const z = nulEnd(d, 1, 0);
        mime = str(d, 1, z - 1).toLowerCase();
        if (mime && !mime.includes('/')) mime = `image/${mime}`;
        p = z + 1;
      }
      const type = d[p];
      const descEnd = nulEnd(d, p + 1, enc);
      const data = d.subarray(descEnd + (enc === 1 || enc === 2 ? 2 : 1));
      // The front cover wins over any other picture.
      if (data.length && (!pic || (type === 3 && pic.type !== 3))) pic = { mime, data, type };
    }
  }
  if (pic) out.picture = { mime: pic.mime, data: pic.data };
  return out;
}

function readFlac(b: Uint8Array): FileTags {
  const out: FileTags = {};
  let o = 4;
  let picType = -1;
  for (;;) {
    if (o + 4 > b.length) break;
    const last = b[o] & 0x80, type = b[o] & 0x7f, len = u24(b, o + 1);
    const d = b.subarray(o + 4, o + 4 + len);
    o += 4 + len;
    if (type === 4) {
      // VORBIS_COMMENT: little-endian lengths.
      const le = (x: number): number => (d[x] | (d[x + 1] << 8) | (d[x + 2] << 16) | (d[x + 3] << 24)) >>> 0;
      let p = 4 + le(0);
      const n = le(p); p += 4;
      for (let i = 0; i < n && p + 4 <= d.length; i++) {
        const l = le(p); p += 4;
        const kv = new TextDecoder().decode(d.subarray(p, p + l)); p += l;
        const eq = kv.indexOf('=');
        const k = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1).trim();
        if (k === 'TITLE') out.title = v; else if (k === 'ARTIST') out.artist = v; else if (k === 'ALBUM') out.album = v;
      }
    } else if (type === 6 && len < MAX_PICTURE) {
      const pt = u32(d, 0);
      let p = 4;
      const ml = u32(d, p); p += 4;
      const mime = str(d, p, ml); p += ml;
      const dl = u32(d, p); p += 4 + dl + 16;
      const n = u32(d, p); p += 4;
      if (!out.picture || (pt === 3 && picType !== 3)) { out.picture = { mime, data: d.subarray(p, p + n) }; picType = pt; }
    }
    if (last) break;
  }
  return out;
}

function readMp4(b: Uint8Array): FileTags {
  const out: FileTags = {};
  // Walk boxes, descending into the containers that hold iTunes metadata.
  const walk = (start: number, end: number, depth: number): void => {
    let o = start;
    while (o + 8 <= end && depth < 8) {
      let size = u32(b, o);
      const type = str(b, o + 4, 4);
      let hdr = 8;
      if (size === 1) { size = u32(b, o + 12) + u32(b, o + 8) * 2 ** 32; hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr) break;
      const body = o + hdr, next = o + size;
      if (type === 'moov' || type === 'udta' || type === 'ilst' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') walk(body, Math.min(next, end), depth + 1);
      // iTunes' 'meta' is a full box (version + flags first); QuickTime's isn't.
      else if (type === 'meta') walk(str(b, body + 4, 4) === 'hdlr' ? body : body + 4, Math.min(next, end), depth + 1);
      else if (type === '©nam' || type === '©ART' || type === '©alb' || type === 'covr') {
        // Child 'data' box: size, 'data', type (4), locale (4), payload.
        const ds = u32(b, body), dt = str(b, body + 4, 4);
        if (dt === 'data' && ds >= 16) {
          const kind = u32(b, body + 8) & 0xffffff;
          const payload = b.subarray(body + 16, body + ds);
          if (type === 'covr') { if (payload.length < MAX_PICTURE && !out.picture) out.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: payload }; } else {
            const text = new TextDecoder().decode(payload).trim();
            if (type === '©nam') out.title = text; else if (type === '©ART') out.artist = text; else out.album = text;
          }
        }
      }
      o = next;
    }
  };
  walk(0, b.length, 0);
  return out;
}
