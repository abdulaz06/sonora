// Event layer on the generated test tracks (native analyser, then EventDetector).
// Needs `npm run gen:audio` (CI runs it first); skipped when the WAVs are missing.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventDetector, type SonoraEvent } from '../src/engine/events';
import type { AudioFeatureFrame } from '../src/types/audio-frame';

const ROOT = join(__dirname, '..');
const has = existsSync(join(ROOT, 'test-audio', 'house-124.wav'));

function events(track: string): SonoraEvent[] {
  const out = execFileSync('cargo', ['run', '-q', '-p', 'sonora-dsp', '--example', 'analyze_wav', '--release', '--',
    join(ROOT, 'test-audio', `${track}.wav`)], { encoding: 'utf8', maxBuffer: 1 << 30, cwd: ROOT });
  const det = new EventDetector();
  const evs: SonoraEvent[] = [];
  det.on((e) => evs.push(e));
  for (const line of out.trim().split('\n')) det.process(JSON.parse(line) as AudioFeatureFrame);
  return evs;
}
const markers = (track: string): Record<string, number> =>
  JSON.parse(readFileSync(join(ROOT, 'test-audio', 'tracks.json'), 'utf8'))[track].markers;

describe.skipIf(!has)('event layer on generated tracks', () => {
  it('house-124: build before the drop, drop on time, breakdown later', () => {
    const e = events('house-124');
    const drop = e.find((x) => x.type === 'drop');
    expect(drop).toBeDefined();
    expect(Math.abs(drop!.time - markers('house-124').drop)).toBeLessThan(1.5);
    expect(e.some((x) => x.type === 'build' && x.time < drop!.time)).toBe(true);
    expect(e.some((x) => x.type === 'breakdown' && x.time > drop!.time)).toBe(true);
  }, 180000);

  it('halftime-140: drop found on time', () => {
    const drop = events('halftime-140').find((x) => x.type === 'drop');
    expect(drop).toBeDefined();
    expect(Math.abs(drop!.time - markers('halftime-140').drop)).toBeLessThan(1.5);
  }, 180000);

  it('silence-fadein: no false drop', () => {
    expect(events('silence-fadein').some((x) => x.type === 'drop')).toBe(false);
  }, 180000);
});
