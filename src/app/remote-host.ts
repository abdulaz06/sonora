/**
 * The output's side of the controller link (D84): broadcasts the state the
 * controller mirrors, applies its calls, runs its forwarded shortcuts, and
 * keeps the preview tap running only while a controller is there. Losing the
 * controller (closed, crashed) changes nothing on the output.
 */

import { coverKey } from './album-colours';
import type { Controller } from './controller';
import { COMMIT_FIELDS, LINK_TIMEOUT_MS, openLink, REMOTE_CALLS, type CommitField, type LinkMsg, type RemoteState } from './link';
import type { Platform } from './platform';
import { PreviewTap } from './preview-tap';
import type { Shell } from './shell';
import { audioStatus, nowPlaying } from './stores';

// ── Tuning ──────────────────────────────────────────────────────
/** Level meter updates to the controller per second. */
const LEVEL_HZ = 12;
/** Display list refresh while a controller is linked (ms). */
const MONITORS_MS = 4000;

export interface RemoteHost {
  /** A controller is linked right now. */
  linked(): boolean;
  readonly tap: PreviewTap | null;
}

export function initRemoteHost(ctl: Controller, shell: Shell, platform: Platform): RemoteHost {
  const link = openLink();
  const gl = ctl.renderer.canvas.getContext('webgl2');
  const tap = gl ? new PreviewTap(gl) : null;
  if (tap) ctl.renderer.setFrameHook((_gl, now) => tap.onFrame(now));
  let lastPing = -Infinity;
  let monitors: RemoteState['monitors'] = [];
  let outputMonitor = '';
  let sentArt = '';
  let queued = false;
  let fullscreen = platform.isFullscreen();

  const linked = (): boolean => performance.now() - lastPing < LINK_TIMEOUT_MS;

  const state = (): RemoteState => {
    const a = ctl.album.get();
    const m = nowPlaying.get();
    const { level: _level, ...audio } = audioStatus.get();
    void _level;
    return {
      settings: ctl.settings,
      album: { status: a.status, artKey: a.art ? coverKey(a.art) : '', palette: a.palette },
      np: m ? { ...m, art: undefined, artKey: m.art ? coverKey(m.art) : '' } as RemoteState['np'] : null,
      audio,
      blackout: ctl.isBlackout(),
      frozen: ctl.renderer.isFrozen(),
      fullscreen,
      screen: shell.screen(),
      displayHz: ctl.renderer.displayHz(),
      version: platform.version,
      platform: platform.kind,
      monitors,
      outputMonitor,
      rec: platform.recorder ? { state: platform.recorder.status().state, elapsed: platform.recorder.status().elapsed } : null,
    };
  };
  const sendArt = (): void => {
    // Covers are big: sent once per new cover, not with every state.
    const art = ctl.album.get().art || nowPlaying.get()?.art || '';
    const key = art ? coverKey(art) : '';
    if (key === sentArt) return;
    sentArt = key;
    if (art) link.send({ t: 'art', key, art });
  };
  const broadcast = (): void => {
    if (!linked() || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sendArt(); link.send({ t: 'state', s: state() }); });
  };

  ctl.subscribe(broadcast);
  platform.recorder?.onChange(broadcast);
  ctl.album.subscribe(broadcast, false);
  nowPlaying.subscribe(broadcast, false);
  platform.onFullscreenChange((fs) => { fullscreen = fs; broadcast(); void refreshMonitors(); });
  let lastAudio = '';
  audioStatus.subscribe((a) => {
    const k = `${a.device}|${a.hearing}|${a.pinned}`;
    if (k !== lastAudio) { lastAudio = k; broadcast(); }
  }, false);
  // The level meter, at a gentle rate.
  window.setInterval(() => { if (linked()) link.send({ t: 'level', v: audioStatus.get().level }); }, 1000 / LEVEL_HZ);

  async function refreshMonitors(): Promise<void> {
    if (!platform.listMonitors) return;
    const [list, cur] = await Promise.all([platform.listMonitors(), platform.outputMonitor?.() ?? Promise.resolve('')]);
    const changed = JSON.stringify(list) !== JSON.stringify(monitors) || cur !== outputMonitor;
    monitors = list; outputMonitor = cur;
    if (changed) broadcast();
  }
  window.setInterval(() => { if (linked()) void refreshMonitors(); }, MONITORS_MS);

  const setLinked = (): void => {
    const was = linked();
    lastPing = performance.now();
    tap?.setActive(true);
    if (!was) { sentArt = ''; void refreshMonitors(); broadcast(); }
  };
  // Drop the preview as soon as the controller goes quiet.
  window.setInterval(() => { if (!linked() && tap?.isActive()) tap.setActive(false); }, 500);

  link.on((msg: LinkMsg) => {
    switch (msg.t) {
      case 'hello': lastPing = -Infinity; setLinked(); break;
      case 'ping': setLinked(); break;
      case 'call': {
        if (!(REMOTE_CALLS as readonly string[]).includes(msg.m)) return;
        const fn = ctl[msg.m] as unknown as (...a: unknown[]) => void;
        fn(...msg.a);
        broadcast();
        break;
      }
      case 'commit': {
        const s = ctl.settings as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(msg.patch)) if ((COMMIT_FIELDS as readonly string[]).includes(k)) s[k as CommitField] = v;
        ctl.commit();
        break;
      }
      case 'act': {
        const a = msg.act;
        if (a.a === 'setSetMode') shell.setSetMode(a.on);
        else if (a.a === 'switchNow') { if (ctl.settings.setMode.on) shell.setMode.switchNow(false); }
        else if (a.a === 'goVisual') shell.goVisual();
        else if (a.a === 'goMenu') shell.goMenu();
        else if (a.a === 'toggleFullscreen') platform.toggleFullscreen();
        else if (a.a === 'moveOutput') void platform.moveOutput?.(a.monitor).then(refreshMonitors);
        else if (a.a === 'media') platform.mediaControl?.(a.v);
        else if (a.a === 'setDevice') { ctl.settings.audioDevice = a.id; ctl.settings.audioDeviceName = a.id === 'default' ? '' : a.name; ctl.commit(); platform.setDevice(a.id, a.name); }
        else if (a.a === 'key') shell.key(a.key);
        else if (a.a === 'record') shell.toggleRecord();
        broadcast();
        break;
      }
      default: break;
    }
  });
  window.addEventListener('beforeunload', () => link.send({ t: 'bye' }));

  return { linked, tap };
}
