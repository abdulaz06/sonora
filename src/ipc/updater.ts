/** Updates from GitHub Releases (tauri-plugin-updater, signed latest.json). */

import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

let pending: Update | null = null;

/** The available version, or null (also on any error: updates never get in the way). */
export async function checkForUpdate(): Promise<string | null> {
  try {
    pending = await check();
    return pending ? pending.version : null;
  } catch (err) {
    console.warn('Update check failed:', err);
    return null;
  }
}

export async function installUpdate(): Promise<void> {
  try {
    const u = pending ?? await check();
    if (!u) return;
    await u.downloadAndInstall();
    await relaunch();
  } catch (err) {
    console.warn('Update install failed:', err);
  }
}
