/**
 * What differs between the desktop app and the web page. The shell and
 * screens only talk to this interface.
 */

import type { DeviceInfo } from '../ipc/audio-device';

export type MediaAction = 'prev' | 'playpause' | 'next';

export interface MonitorInfo { name: string; label: string }

export interface Platform {
  kind: 'desktop' | 'web';
  /** Output devices (desktop) for the audio chooser. */
  listDevices(): Promise<DeviceInfo[]>;
  /** Pin a device by id, or 'default' to follow Windows. */
  setDevice(id: string, name: string): void;
  /** Web: open the browser source chooser (tab / file / mic). */
  openSourceChooser?(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
  onFullscreenChange(cb: (fs: boolean) => void): void;
  /** Displays for fullscreen (desktop). */
  listMonitors?(): Promise<MonitorInfo[]>;
  mediaControl?(a: MediaAction): void;
  /** Check for an update; resolves with its version or null. */
  checkForUpdate?(): Promise<string | null>;
  installUpdate?(): Promise<void>;
  version: string;
  /** Tray / other process events into the app. */
  onTray?(cb: (action: string) => void): void;
  /** Tell the tray Set Mode's state. */
  setTraySetMode?(on: boolean): void;
}
