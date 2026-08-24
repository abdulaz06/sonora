/**
 * Audio capture device — listing, current selection, and live "device
 * changed" event from the Rust backend.
 *
 * The backend monitors the system default device on its own thread; this
 * bridge just exposes the four touchpoints the UI needs:
 *  - listDevices(): enumerate output devices for the dropdown
 *  - getCurrentDevice(): name + pinned-ness of what we're capturing now
 *  - setDevice(): pin to an id, or pass 'default' to follow the system default
 *  - onDeviceChanged(): subscribe to live changes (auto-switch or manual swap)
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface CurrentDevice {
  /** Empty string if no device is currently capturing. */
  name: string;
  pinned: boolean;
  /** When pinned, the id the user requested. May be unavailable right now. */
  pinned_id: string | null;
}

export async function listDevices(): Promise<DeviceInfo[]> {
  try {
    return await invoke<DeviceInfo[]>('get_audio_devices');
  } catch (err) {
    console.warn('Failed to list audio devices:', err);
    return [];
  }
}

export async function getCurrentDevice(): Promise<CurrentDevice> {
  try {
    return await invoke<CurrentDevice>('get_current_audio_device');
  } catch (err) {
    console.warn('Failed to get current audio device:', err);
    return { name: '', pinned: false, pinned_id: null };
  }
}

/** Pass 'default' to follow the system default; any other id pins. */
export async function setDevice(id: string): Promise<void> {
  try {
    await invoke('set_audio_device', { id: id === 'default' ? null : id });
  } catch (err) {
    console.warn('Failed to set audio device:', err);
  }
}

export async function onDeviceChanged(
  callback: (name: string) => void,
): Promise<() => void> {
  return listen<string>('audio-device-changed', (event) => {
    callback(event.payload);
  });
}
