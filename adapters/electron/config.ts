/** Electron adapter constants. */
export const APP_NAME = 'Pixel Agents';
export const STATE_NAMESPACE = 'electron' as const;

/** BrowserWindow background color (matches the webview's --pixel-bg token). */
export const WINDOW_BACKGROUND_COLOR = '#1e1e2e';

/** Setting keys for native attention (read by attention.ts, written by the UI). */
export const NOTIFY_KEYS = {
  master: 'pixel-agents.nativeAttentionEnabled',
  osNotification: 'pixel-agents.notify.osNotification',
  osSound: 'pixel-agents.notify.osSound',
  dockBounce: 'pixel-agents.notify.dockBounce',
  dockBadge: 'pixel-agents.notify.dockBadge',
  menubarCount: 'pixel-agents.notify.menubarCount',
  bringToFront: 'pixel-agents.notify.bringToFront',
} as const;

export const NOTIFY_DEFAULTS = {
  nativeAttentionEnabled: true,
  osNotification: true,
  osSound: true,
  dockBounce: true,
  dockBadge: true,
  menubarCount: true,
  bringToFront: false,
} as const;

/** Setting key for persisted window bounds. */
export const WINDOW_STATE_KEY = 'pixel-agents.windowState';

/** Debounce window for repeated attention signals per agent. */
export const ATTENTION_DEBOUNCE_MS = 1500;
