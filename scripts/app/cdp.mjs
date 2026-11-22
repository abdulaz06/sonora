// Drive the real desktop app's webview (WebView2) from Node: start the app with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri dev
// then connectApp() attaches Playwright over CDP to the main window's page.
// Used by the export / recording checks (render speed, A/V sync, pacing).
import { chromium } from 'playwright';

export const CDP_PORT = Number(process.env.SONORA_CDP_PORT || 9333);

export async function connectApp({ label = 'main', timeoutMs = 240000 } = {}) {
  const t0 = Date.now();
  let browser = null;
  while (Date.now() - t0 < timeoutMs) {
    try { browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!browser) throw new Error(`no webview on :${CDP_PORT} (start the app with remote debugging)`);
  while (Date.now() - t0 < timeoutMs) {
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) {
      const u = p.url();
      if ((label === 'main' && !u.includes('controller')) || (label !== 'main' && u.includes(label))) {
        if (u.startsWith('http')) return { browser, page: p };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('main page not found');
}
