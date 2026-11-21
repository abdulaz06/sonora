import { describe, expect, it } from 'vitest';
import { pictureUrl, readTags } from './tags';

const enc = new TextEncoder();
const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const arr: number[] = [];
  for (const p of parts) arr.push(...(typeof p === 'string' ? enc.encode(p) : p));
  return new Uint8Array(arr);
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const be24 = (n: number): number[] => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const syncsafe = (n: number): number[] => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9];

describe('embedded tags', () => {
  it('ID3v2.3: title, artist, album and the front cover (APIC)', () => {
    const frame = (id: string, body: Uint8Array): Uint8Array => bytes(id, be32(body.length), [0, 0], body);
    const text = (s: string): Uint8Array => bytes([3], s);
    const apic = bytes([0], 'image/jpeg', [0], [3], 'cover', [0], JPEG);
    const frames = bytes(frame('TIT2', text('Night Drive')), frame('TPE1', text('Lumen Field')), frame('TALB', text('Low Light')), frame('APIC', apic));
    const file = bytes('ID3', [3, 0, 0], syncsafe(frames.length), frames, [0xff, 0xfb, 0x90, 0x00]);
    const t = readTags(file.buffer as ArrayBuffer);
    expect([t.title, t.artist, t.album]).toEqual(['Night Drive', 'Lumen Field', 'Low Light']);
    expect(Array.from(t.picture!.data)).toEqual(JPEG);
    expect(pictureUrl(t).startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('ID3v2.4 with UTF-16 text and a non-cover picture before the front cover', () => {
    const frame = (id: string, body: Uint8Array): Uint8Array => bytes(id, syncsafe(body.length), [0, 0], body);
    const utf16 = (s: string): Uint8Array => { const a = [0xff, 0xfe]; for (const ch of s) { a.push(ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8); } return new Uint8Array(a); };
    const back = bytes([0], 'image/png', [0], [4], [0], [0x89, 0x50, 9, 9]);
    const front = bytes([1], 'image/jpeg', [0], [3], [0xff, 0xfe, 0, 0], JPEG);
    const frames = bytes(frame('TIT2', bytes([1], utf16('Échos'))), frame('APIC', back), frame('APIC', front));
    const t = readTags(bytes('ID3', [4, 0, 0], syncsafe(frames.length), frames).buffer as ArrayBuffer);
    expect(t.title).toBe('Échos');
    expect(Array.from(t.picture!.data)).toEqual(JPEG);
  });

  it('FLAC: VORBIS_COMMENT and PICTURE blocks', () => {
    const vendor = 'test';
    const comments = ['TITLE=Tide', 'ARTIST=Shore', 'ALBUM=Coast'];
    const vc = bytes(le32(vendor.length), vendor, le32(comments.length), ...comments.flatMap((c) => [le32(enc.encode(c).length), c]));
    const mime = 'image/jpeg';
    const pic = bytes(be32(3), be32(mime.length), mime, be32(0), be32(500), be32(500), be32(24), be32(0), be32(JPEG.length), JPEG);
    const block = (type: number, last: boolean, body: Uint8Array): Uint8Array => bytes([(last ? 0x80 : 0) | type], be24(body.length), body);
    const file = bytes('fLaC', block(0, false, new Uint8Array(34)), block(4, false, vc), block(6, true, pic));
    const t = readTags(file.buffer as ArrayBuffer);
    expect([t.title, t.artist, t.album]).toEqual(['Tide', 'Shore', 'Coast']);
    expect(t.picture!.mime).toBe('image/jpeg');
    expect(Array.from(t.picture!.data)).toEqual(JPEG);
  });

  it('M4A: iTunes ilst (©nam, ©ART, ©alb, covr)', () => {
    const t = readTags(m4a().buffer as ArrayBuffer);
    expect([t.title, t.artist, t.album]).toEqual(['Glass', 'Prism', 'Light']);
    expect(Array.from(t.picture!.data)).toEqual(JPEG);
  });

  it('no tags or garbage: nothing, never a throw', () => {
    expect(readTags(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer)).toEqual({});
    expect(readTags(bytes('ID3', [3, 0, 0], syncsafe(999), 'TIT2').buffer as ArrayBuffer)).toBeDefined();
    expect(readTags(bytes('fLaC', [4], be24(99999)).buffer as ArrayBuffer)).toBeDefined();
  });
});

/** A minimal M4A: ftyp + moov/udta/meta(full box, hdlr)/ilst; box types are latin-1 (© is 0xA9). */
function m4a(): Uint8Array {
  const box = (type: string, body: number[]): number[] => [...be32(8 + body.length), ...Array.from(type, (c) => c.charCodeAt(0) & 255), ...body];
  const data = (kind: number, payload: number[]): number[] => box('data', [...be32(kind), ...be32(0), ...payload]);
  const txt = (s: string): number[] => Array.from(enc.encode(s));
  const ilst = box('ilst', [
    ...box('©nam', data(1, txt('Glass'))), ...box('©ART', data(1, txt('Prism'))), ...box('©alb', data(1, txt('Light'))),
    ...box('covr', data(13, JPEG)),
  ]);
  const meta = box('meta', [0, 0, 0, 0, ...box('hdlr', new Array(25).fill(0)), ...ilst]);
  return new Uint8Array([...box('ftyp', [...txt('M4A '), ...be32(0)]), ...box('moov', box('udta', meta))]);
}
