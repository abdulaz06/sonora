#!/usr/bin/env node
// Voyage shader compile + link time, cold (a fresh browser profile each run):
// the 1.0.2 raymarch shader against the current one.
//   node scripts/voyage-compile.mjs [runs]   (old sources: node_modules/.cache/old-{march.frag,backdrop.glsl})
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
const PORT = 5196, runs = Number(process.argv[2] || 3);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-5196' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const res = { old: [], new: [] };
  for (let k = 0; k < runs; k++) {
    for (const which of ['old', 'new']) {
      const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-shader-disk-cache'] });
      const p = await b.newPage();
      await p.goto(`http://localhost:${PORT}/web.html?harness=1`);
      await p.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
      const ms = await p.evaluate(async (w) => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const { makeProgram, withIncludes } = await import('/src/styles/shared/gl.ts');
        const noise = (await import('/src/styles/shared/noise.glsl?raw')).default;
        const vert = (await import('/src/styles/shared/fullscreen.vert?raw').catch(() => ({ default: '#version 300 es\nlayout(location=0) in vec2 a;void main(){gl_Position=vec4(a,0,1);}' }))).default;
        let frag;
        if (w === 'old') {
          const m = await fetch('/node_modules/.cache/old-march.frag').then((r) => r.text());
          const bd = await fetch('/node_modules/.cache/old-backdrop.glsl').then((r) => r.text());
          frag = withIncludes(m, { noise, backdrop: bd });
        } else {
          const m = (await import('/src/styles/voyage/shaders/march.frag?raw')).default;
          const bd = (await import('/src/styles/voyage/shaders/backdrop.glsl?raw')).default;
          const lay = (await import('/src/styles/voyage/shaders/layout.glsl?raw')).default;
          frag = withIncludes(m, { noise, backdrop: withIncludes(bd, { layout: lay }) });
        }
        const t0 = performance.now();
        makeProgram(gl, vert, frag);
        return performance.now() - t0;
      }, which);
      res[which].push(+ms.toFixed(0));
      await b.close();
    }
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`Voyage march shader compile + link (cold): 1.0.2 ${res.old.join(' / ')} ms (median ${med(res.old)}), now ${res.new.join(' / ')} ms (median ${med(res.new)}): +${med(res.new) - med(res.old)} ms`);
} finally { kill(); }
