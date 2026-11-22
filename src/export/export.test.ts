import { describe, expect, it } from 'vitest';
import { readTags } from '../audio/tags';
import { unpackFrames } from './mp4';
import { recordSize } from './recorder';
import { buildPlan, cutTimes, snapToBar } from './plan-lib.mjs';
import { parseFileName, tidyTitle } from './song';

/** An Ogg page holding the given packets (lacing only; CRC left zero, the reader ignores it). */
function oggPage(packets: Uint8Array[]): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const head = new Uint8Array(27 + lacing.length);
  head.set([0x4f, 0x67, 0x67, 0x53]);
  head[26] = lacing.length;
  head.set(lacing, 27);
  const body = packets.reduce((a, p) => { const o = new Uint8Array(a.length + p.length); o.set(a); o.set(p, a.length); return o; }, new Uint8Array(0));
  const out = new Uint8Array(head.length + body.length);
  out.set(head); out.set(body, head.length);
  return out;
}
const le32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
const ascii = (s: string): number[] => [...new TextEncoder().encode(s)];

describe('export pieces', () => {
  it('reads Opus tags from an Ogg file', () => {
    const vendor = ascii('test');
    const comments = ['TITLE=Night Drive', 'ARTIST=Lumen Field', 'ALBUM=Low Light'].map(ascii);
    const tags = new Uint8Array([...ascii('OpusTags'), ...le32(vendor.length), ...vendor, ...le32(comments.length), ...comments.flatMap((c) => [...le32(c.length), ...c])]);
    const head = new Uint8Array([...ascii('OpusHead'), 1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]);
    const file = new Uint8Array([...oggPage([head]), ...oggPage([tags])]);
    expect(readTags(file.buffer)).toMatchObject({ title: 'Night Drive', artist: 'Lumen Field', album: 'Low Light' });
  });

  it('unpacks AAC frames from the Rust buffer', () => {
    const buf = new Uint8Array([...le32(2), ...le32(3), ...le32(1), 9, 8, 7, 6]);
    expect(unpackFrames(buf.buffer).map((f) => [...f])).toEqual([[9, 8, 7], [6]]);
    expect(unpackFrames(new ArrayBuffer(0))).toEqual([]);
  });

  it('sizes recordings from the output or a preset (even, aspect kept, at most 4K)', () => {
    expect(recordSize(2560, 1440, 'output')).toEqual([2560, 1440]);
    expect(recordSize(5120, 2880, 'output')).toEqual([3840, 2160]);
    expect(recordSize(1366, 768, '1080')).toEqual([1920, 1080]);
    expect(recordSize(1080, 1920, '720')).toEqual([720, 1280]);
  });

  it('names songs from files and tidies store titles', () => {
    expect(parseFileName('I Wonder - Kanye West.mp3')).toEqual({ title: 'I Wonder', artist: 'Kanye West' });
    expect(parseFileName('demo.wav')).toEqual({ title: 'demo', artist: '' });
    expect(tidyTitle('I Wonder (Clean) (feat. Labi Siffre)')).toBe('I Wonder');
  });

  it('snaps to bars and lands a drop on a tour cut', () => {
    const bars = [0, 2, 4, 6, 8, 10, 12, 14, 16];
    expect(snapToBar(4.9, bars)).toBe(4);
    const cuts = cutTimes({ start: 2, end: 16 }, bars, [{ type: 'drop', t: 8.1, strength: 1 }], 3);
    expect(cuts).toContain(8);
    const plan = buildPlan({ format: 'beatswitch', song: 's', title: '', artist: '', window: { start: 2, end: 16 }, combo: 'ink-glow-depth', palette: 0, combo2: 'voyage-city', switchAt: 9.6, text: 'none', labels: false, nowPlaying: false }, { bars, events: [] } as never);
    expect(plan.shots.map((s) => [s.at, s.style])).toEqual([[2, 'ink'], [10, 'voyage']]);
  });
});
