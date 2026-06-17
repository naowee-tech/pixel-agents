import { app, BrowserWindow } from 'electron';
import * as path from 'path';

import type { StandaloneHandle } from '../../server/src/standalone.js';
import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import { APP_NAME, STATE_NAMESPACE, WINDOW_BACKGROUND_COLOR } from './config.js';

let handle: StandaloneHandle | null = null;
let win: BrowserWindow | null = null;

/** dist/ root: electron-main.js is bundled to dist/, so __dirname === dist/. */
function distRoot(): string {
  return __dirname;
}

async function boot(): Promise<void> {
  handle = await startStandaloneServer({
    distRoot: distRoot(),
    port: 0,
    namespace: STATE_NAMESPACE,
  });

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: APP_NAME,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`http://127.0.0.1:${handle.config.port}`);
  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(boot).catch((err) => {
  console.error('[Pixel Agents] Failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void boot();
});

app.on('before-quit', () => {
  if (handle) stopStandalone(handle);
  handle = null;
});

// Silence unused-import lint until window.ts uses path in Task 4.
void path;
