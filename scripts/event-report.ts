// Prints the event timeline for a test track (native analyser → EventDetector).
//   npm run events -- house-124
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventDetector } from '../src/engine/events';
import type { AudioFeatureFrame } from '../src/types/audio-frame';

const track = process.argv[2] ?? 'house-124';
const root = process.cwd();
const out = execFileSync('cargo', ['run', '-q', '-p', 'sonora-dsp', '--example', 'analyze_wav', '--release', '--',
  join(root, 'test-audio', `${track}.wav`)], { encoding: 'utf8', maxBuffer: 1 << 30 });
const meta = JSON.parse(readFileSync(join(root, 'test-audio', 'tracks.json'), 'utf8'))[track];
const det = new EventDetector();
let lastSection = '';
det.on((e) => console.log(`  ${e.time.toFixed(2).padStart(7)}s  EVENT ${e.type.padEnd(11)} strength=${e.strength.toFixed(2)}`));
out.trim().split('\n').forEach((line, i) => {
  det.process(JSON.parse(line) as AudioFeatureFrame);
  const s = det.state.section;
  if (s !== lastSection) { console.log(`  ${((i + 1) / 60).toFixed(2).padStart(7)}s  section → ${s}`); lastSection = s; }
});
console.log('markers', JSON.stringify(meta.markers));
