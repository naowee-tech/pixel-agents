import { app, BrowserWindow } from 'electron';

import type { StandaloneHandle } from '../../server/src/standalone.js';
import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import { STATE_NAMESPACE } from './config.js';
import { createMainWindow } from './window.js';

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

  win = createMainWindow({
    url: `http://127.0.0.1:${handle.config.port}`,
    getSetting: (key, def) => handle!.adapter.getSetting(key, def),
    setSetting: (key, val) => handle!.adapter.setSetting(key, val),
  });
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
