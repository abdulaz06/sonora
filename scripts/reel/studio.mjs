#!/usr/bin/env node
// The reel studio (local tool, never part of the app or the site):
//   npm run studio        → http://localhost:5300/studio.html
// A Vite dev server for the studio page plus a small local API: the songs in
// local-media/songs, their whole-song analysis (real DSP), covers, saved
// plans, the render queue, and renders (scripts/reel/render.mjs). Everything
// stays on this machine.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { analyse, ensureWav, findCover, listSongs, probeTags, REELS, ROOT, slugify } from './lib.mjs';

const PORT = Number(process.env.STUDIO_PORT || 5300);
const QUEUE = join(REELS, 'queue.json');
const PLANS = join(REELS, 'plans');
mkdirSync(PLANS, { recursive: true });
const jobs = new Map();   // id → { status, log, out }

const json = (res, v, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b ? JSON.parse(b) : null)); });
const songBy = (slug) => listSongs().find((s) => s.slug === slug);

function api() {
  return {
    name: 'sonora-studio-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          const p = url.pathname.slice(5);
          if (p === 'songs') return json(res, listSongs().map((s) => ({ ...s, ...probeTags(s.path), slug: s.slug, file: s.file, cover: !!findCover(s) })));
          const s = url.searchParams.get('song') ? songBy(url.searchParams.get('song')) : null;
          if (p === 'analysis') { if (!s) return json(res, { error: 'no song' }, 404); ensureWav(s); return json(res, analyse(s)); }
          if (p === 'wav') { if (!s) return json(res, { error: 'no song' }, 404); const f = ensureWav(s); res.setHeader('content-type', 'audio/wav'); res.setHeader('content-length', statSync(f).size); return createReadStream(f).pipe(res); }
          if (p === 'cover') {
            const f = s ? findCover(s) : null;
            if (!f) return json(res, { error: 'no cover' }, 404);
            res.setHeader('content-type', /\.png$/i.test(f) ? 'image/png' : 'image/jpeg');
            return createReadStream(f).pipe(res);
          }
          if (p === 'queue' && req.method === 'GET') return json(res, existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, 'utf8')) : []);
          if (p === 'queue' && req.method === 'POST') {
            const plan = await body(req);
            const q = existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, 'utf8')) : [];
            q.push({ added: new Date().toISOString(), plan });
            writeFileSync(QUEUE, JSON.stringify(q, null, 1));
            return json(res, { ok: true, jobs: q.filter((j) => !j.done).length });
          }
          if (p === 'plan' && req.method === 'POST') {
            const plan = await body(req);
            const f = join(PLANS, `${plan.name ?? slugify(plan.song ?? 'plan')}.json`);
            writeFileSync(f, JSON.stringify(plan, null, 1));
            return json(res, { ok: true, file: f });
          }
          if (p === 'render' && req.method === 'POST') {
            const { plan, draft } = await body(req);
            const id = `${Date.now().toString(36)}`;
            const f = join(PLANS, `${plan.name ?? id}.json`);
            writeFileSync(f, JSON.stringify(plan, null, 1));
            const job = { status: 'running', log: '', out: null, draft: !!draft };
            jobs.set(id, job);
            const child = spawn(process.execPath, [join(ROOT, 'scripts', 'reel', 'render.mjs'), f, ...(draft ? ['--draft'] : [])], { cwd: ROOT });
            const add = (d) => { job.log = (job.log + d.toString()).slice(-6000); const m = /→ (.+?) \(reel\.mp4/.exec(job.log); if (m) job.out = m[1]; };
            child.stdout.on('data', add); child.stderr.on('data', add);
            child.on('exit', (code) => { job.status = code === 0 ? 'done' : 'failed'; });
            return json(res, { id });
          }
          if (p === 'render' && req.method === 'GET') return json(res, jobs.get(url.searchParams.get('id') ?? '') ?? { status: 'unknown' });
          if (p === 'open' && req.method === 'POST') {
            const { path } = await body(req);
            if (path && path.startsWith(join(ROOT, 'local-media'))) spawn('explorer', [path], { detached: true });
            return json(res, { ok: true });
          }
          return json(res, { error: 'unknown endpoint' }, 404);
        } catch (e) { return json(res, { error: String(e) }, 500); }
      });
    },
  };
}

const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, 'vite.config.ts'),
  cacheDir: join(ROOT, 'node_modules', '.vite-studio'),
  server: { port: PORT, strictPort: true, open: '/studio.html' },
  plugins: [api()],
});
await server.listen();
console.log(`reel studio: http://localhost:${PORT}/studio.html  (songs: local-media/songs, covers: local-media/covers)`);
void execFileSync;
