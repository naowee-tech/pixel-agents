import { nativeImage, Tray } from 'electron';

import type { StateAdapter } from '../../core/src/adapter.js';
import { NOTIFY_DEFAULTS, NOTIFY_KEYS } from './config.js';

export interface WaitingTray {
  setCount: (n: number) => void;
  destroy: () => void;
}

export function createWaitingTray(adapter: StateAdapter): WaitingTray {
  // Empty 1x1 transparent image; macOS shows the title text next to it.
  const tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Pixel Agents');

  const setCount = (n: number): void => {
    const master = adapter.getSetting(NOTIFY_KEYS.master, NOTIFY_DEFAULTS.nativeAttentionEnabled);
    const show = master && adapter.getSetting(NOTIFY_KEYS.menubarCount, NOTIFY_DEFAULTS.menubarCount);
    tray.setTitle(show && n > 0 ? `⏳${n}` : '');
  };

  return {
    setCount,
    destroy: () => tray.destroy(),
  };
}
