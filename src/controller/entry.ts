/**
 * controller.html entry: in the desktop app (a second Tauri window) it can
 * list devices and displays itself and close its own window; in a browser tab
 * (the web dev page, screenshots) it talks to the output tab the same way.
 */

import { bootController } from './main';

async function start(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) { await bootController(); return; }
  const [{ listDevices }, win, safety] = await Promise.all([
    import('../ipc/audio-device'),
    import('@tauri-apps/api/window'),
    import('../app/window-safety'),
  ]);
  safety.watchVisibility();
  await bootController({
    listDevices,
    listMonitors: async () => {
      try {
        const mons = await win.availableMonitors();
        return mons.map((m, i) => ({ name: m.name ?? `display-${i}`, label: `${m.name ?? `Display ${i + 1}`} · ${m.size.width}×${m.size.height}` }));
      } catch { return []; }
    },
    close: () => { void win.getCurrentWindow().close(); },
  });
  if (import.meta.env.DEV) {
    const { invoke } = await import('@tauri-apps/api/core');
    window.setInterval(() => {
      const st = (window as unknown as { __ctlStats?: { fps: number; lag: number } }).__ctlStats;
      const linked = !document.querySelector('.ctl-main.is-waiting');
      void invoke('dev_log', { msg: `linked=${linked} preview fps=${st?.fps ?? 0} latency=${Math.round(st?.lag ?? 0)}ms` }).catch(() => undefined);
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => { void start(); });
