/**
 * Web audio-source UI: a status chip (live level, what is heard, state), a
 * source chooser with plain-language options, and a banner that offers a
 * one-click reconnect when capture stops (device change, sharing stopped).
 */

import type { SourceKind, SourceStatus, WasmFrameSource } from '../audio/wasm-source';

// ── Tuning ──────────────────────────────────────────────────────
const LAST_SOURCE_KEY = 'sonora.web.lastSource';
/** Quiet hints auto-hide after this long (ms). */
const QUIET_BANNER_MS = 9000;

export interface TrackChoice {
  id: string;
  file: string;
}

const CSS = `
#src-chip { display: flex; align-items: center; gap: 8px; cursor: pointer; }
#src-chip .meter { width: 34px; height: 8px; display: flex; gap: 2px; align-items: flex-end; }
#src-chip .meter i { flex: 1; background: rgba(236,231,223,0.18); height: 100%; transform-origin: bottom; }
#src-chip .meter i.on { background: #ECE7DF; }
#src-chip .state { color: rgba(236,231,223,0.45); }
#src-chip .state.warn { color: #ECE7DF; }
#src-sheet {
  position: fixed; top: 58px; left: 16px; width: 380px; z-index: 1002; display: none;
  background: rgba(8,8,10,0.96); border: 1px solid rgba(236,231,223,0.14); color: rgba(236,231,223,0.86);
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; font-size: 12px;
}
#src-sheet.open { display: block; }
#src-sheet .head { padding: 14px 16px 10px; font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 10px;
  letter-spacing: 0.12em; text-transform: uppercase; color: rgba(236,231,223,0.4); }
#src-sheet .opt { display: block; width: 100%; text-align: left; padding: 12px 16px; background: transparent; border: 0;
  border-top: 1px solid rgba(236,231,223,0.1); color: inherit; font: inherit; cursor: pointer; }
#src-sheet .opt:hover, #src-sheet .opt.on { background: rgba(236,231,223,0.07); }
#src-sheet .opt b { display: block; font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 11px; font-weight: 500;
  letter-spacing: 0.1em; text-transform: uppercase; color: #ECE7DF; margin-bottom: 4px; }
#src-sheet .opt b em { font-style: normal; color: rgba(236,231,223,0.45); margin-left: 8px; }
#src-sheet .opt span { color: rgba(236,231,223,0.55); line-height: 1.45; }
#src-sheet .row { display: flex; gap: 8px; margin-top: 8px; }
#src-sheet select { flex: 1; background: #08080A; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.2); padding: 5px;
  font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 10px; }
#src-sheet .go { background: transparent; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.3); padding: 5px 10px; cursor: pointer;
  font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
#src-sheet .foot { padding: 12px 16px; border-top: 1px solid rgba(236,231,223,0.1); color: rgba(236,231,223,0.42); line-height: 1.45; }
#src-banner {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 1003; display: none; max-width: 560px;
  background: rgba(8,8,10,0.96); border: 1px solid rgba(236,231,223,0.3); color: #ECE7DF; padding: 12px 14px;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; font-size: 12px; line-height: 1.45;
}
#src-banner.open { display: flex; gap: 14px; align-items: center; }
#src-banner .msg { flex: 1; }
#src-banner button { background: transparent; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.35); padding: 6px 10px; cursor: pointer;
  white-space: nowrap; font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
#src-banner button.primary { background: #ECE7DF; color: #08080A; }
`;

const KIND_TITLES: Record<SourceKind, string> = {
  tab: 'Browser tab',
  system: 'Whole computer',
  mic: 'Microphone',
  file: 'Audio file',
};

export interface SourceUi {
  /** Element to place in the top bar. */
  chip: HTMLElement;
  open(): void;
}

export function createSourceUi(
  source: WasmFrameSource,
  tracks: TrackChoice[],
  playData: (data: ArrayBuffer | Blob, label: string) => Promise<void>,
): SourceUi {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── Chip ──
  const chip = document.createElement('span');
  chip.id = 'src-chip';
  chip.title = 'Choose what Sonora listens to';
  chip.innerHTML = `<span class="meter">${'<i></i>'.repeat(5)}</span><span class="label">Choose audio</span><span class="state"></span>`;
  const bars = Array.from(chip.querySelectorAll<HTMLElement>('.meter i'));
  const chipLabel = chip.querySelector<HTMLElement>('.label')!;
  const chipState = chip.querySelector<HTMLElement>('.state')!;

  // ── Sheet ──
  const sheet = document.createElement('div');
  sheet.id = 'src-sheet';
  const last = localStorage.getItem(LAST_SOURCE_KEY) as SourceKind | null;
  sheet.innerHTML = `
    <div class="head">What should Sonora listen to?</div>
    <button class="opt" data-k="tab"><b>Browser tab <em>recommended</em></b>
      <span>The tab playing music (Spotify Web Player, YouTube, SoundCloud…). In the picker, choose the tab and keep "Also share tab audio" on. Keeps working when you plug in speakers or headphones.</span></button>
    <button class="opt" data-k="system"><b>Whole computer</b>
      <span>Any app, including the Spotify desktop app. In the picker, choose Entire screen and turn on "Also share system audio". If you switch speakers or headphones, you'll be asked to reconnect with one click.</span></button>
    <div class="opt" data-k="mic"><b>Microphone or line-in</b>
      <span>A mic in the room, or an input on your sound card.</span>
      <div class="row"><select id="src-mic"><option value="">Default microphone</option></select><button class="go" id="src-mic-go">Use</button></div></div>
    <button class="opt" data-k="file"><b>Audio file</b>
      <span>Play a file from your computer. You can also drop a file anywhere on the page.</span></button>
    ${tracks.length ? `<div class="opt" data-k="test"><b>Test tracks</b>
      <span>Generated tracks used to check the visuals.</span>
      <div class="row"><select id="src-test">${tracks.map((t) => `<option value="${t.id}">${t.id}</option>`).join('')}</select><button class="go" id="src-test-go">Play</button></div></div>` : ''}
    <div class="foot">For the smoothest setup, use the Sonora desktop app: it listens to your speakers directly and follows device changes on its own.</div>
  `;
  document.body.appendChild(sheet);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';

  // ── Banner ──
  const banner = document.createElement('div');
  banner.id = 'src-banner';
  banner.innerHTML = `<div class="msg"></div><button class="primary" data-b="reconnect">Reconnect</button><button data-b="choose">Other source</button>`;
  document.body.appendChild(banner);
  const bannerMsg = banner.querySelector<HTMLElement>('.msg')!;
  const reconnectBtn = banner.querySelector<HTMLButtonElement>('[data-b=reconnect]')!;
  let bannerTimer = 0;

  const open = (): void => {
    sheet.classList.add('open');
    void fillMics();
  };
  const close = (): void => sheet.classList.remove('open');

  async function fillMics(): Promise<void> {
    const sel = sheet.querySelector<HTMLSelectElement>('#src-mic');
    if (!sel) return;
    const inputs = await source.listInputs().catch(() => []);
    const current = sel.value;
    sel.innerHTML = '<option value="">Default microphone</option>' + inputs
      .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => `<option value="${d.deviceId}">${(d.label || `Input ${i + 1}`).replace(/</g, '&lt;')}</option>`).join('');
    sel.value = current;
  }

  const remember = (k: SourceKind): void => localStorage.setItem(LAST_SOURCE_KEY, k);
  const run = async (fn: () => Promise<void>): Promise<void> => {
    close();
    try { await fn(); } catch (err) { console.warn('Audio source failed:', err); }
  };

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = source.currentStatus;
    // One-click reconnect to the last capture on a fresh page.
    if (s.state === 'idle' && (last === 'tab' || last === 'system') && !sheet.classList.contains('open')) {
      void run(async () => { await source.useDisplayAudio(last); remember(last); });
      return;
    }
    if (sheet.classList.contains('open')) close(); else open();
  });
  sheet.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (target.closest('select')) return;
    if (target.id === 'src-mic-go') {
      const id = sheet.querySelector<HTMLSelectElement>('#src-mic')!.value || undefined;
      void run(async () => { await source.useMicrophone(id); remember('mic'); });
      return;
    }
    if (target.id === 'src-test-go') {
      const id = sheet.querySelector<HTMLSelectElement>('#src-test')!.value;
      const t = tracks.find((x) => x.id === id);
      if (t) void run(async () => { await playData(await fetch(`/test-audio/${t.file}`).then((r) => r.arrayBuffer()), t.id); });
      return;
    }
    const opt = target.closest<HTMLElement>('.opt');
    const k = opt?.dataset.k;
    if (k === 'tab' || k === 'system') void run(async () => { await source.useDisplayAudio(k); remember(k); });
    else if (k === 'file') { close(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void playData(f, f.name);
  });
  document.addEventListener('click', () => close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  banner.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).dataset.b;
    if (b === 'reconnect') void run(() => source.reconnect());
    else if (b === 'choose') { banner.classList.remove('open'); open(); e.stopPropagation(); }
  });

  // ── Status → UI ──
  source.onStatus((s: SourceStatus) => {
    const title = s.kind ? KIND_TITLES[s.kind] : '';
    chipLabel.textContent = s.state === 'idle'
      ? (last === 'tab' || last === 'system' ? `Reconnect: ${KIND_TITLES[last]}` : 'Choose audio')
      : s.label || title;
    const stateText: Record<SourceStatus['state'], string> = {
      idle: '', starting: 'waiting…', live: '', quiet: 'no sound', reconnect: 'stopped', error: 'not connected',
    };
    chipState.textContent = stateText[s.state];
    chipState.classList.toggle('warn', s.state === 'reconnect' || s.state === 'error');
    sheet.querySelectorAll<HTMLElement>('.opt').forEach((o) => o.classList.toggle('on', o.dataset.k === s.kind && s.state !== 'idle'));

    window.clearTimeout(bannerTimer);
    if (s.state === 'reconnect' || s.state === 'error' || s.state === 'quiet') {
      bannerMsg.textContent = s.message;
      reconnectBtn.style.display = s.state === 'reconnect' ? '' : 'none';
      banner.classList.add('open');
      if (s.state === 'quiet') bannerTimer = window.setTimeout(() => banner.classList.remove('open'), QUIET_BANNER_MS);
    } else {
      banner.classList.remove('open');
    }
  });

  // Live level meter.
  const tick = (): void => {
    const lvl = source.currentStatus.state === 'idle' ? 0 : source.currentStatus.level;
    bars.forEach((b, i) => b.classList.toggle('on', lvl > (i + 0.5) / bars.length * 0.8));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  if (!last) setTimeout(open, 400);
  return { chip, open };
}
