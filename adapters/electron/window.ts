import { BrowserWindow } from 'electron';

import { APP_NAME, WINDOW_BACKGROUND_COLOR, WINDOW_STATE_KEY } from './config.js';

export type GetSetting = <T>(key: string, def: T) => T;
export type SetSetting = <T>(key: string, val: T) => void;

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1100, height: 720 };
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

export function sanitizeBounds(saved: WindowBounds | undefined): WindowBounds {
  if (!saved) return { ...DEFAULT_BOUNDS };
  return {
    width: Math.max(MIN_WIDTH, saved.width || DEFAULT_BOUNDS.width),
    height: Math.max(MIN_HEIGHT, saved.height || DEFAULT_BOUNDS.height),
    x: saved.x,
    y: saved.y,
  };
}

export function createMainWindow(opts: {
  url: string;
  getSetting: GetSetting;
  setSetting: SetSetting;
}): BrowserWindow {
  const bounds = sanitizeBounds(opts.getSetting<WindowBounds | undefined>(WINDOW_STATE_KEY, undefined));

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: APP_NAME,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const persist = (): void => {
    opts.setSetting<WindowBounds>(WINDOW_STATE_KEY, win.getBounds());
  };
  win.on('close', persist);

  void win.loadURL(opts.url);
  return win;
}
