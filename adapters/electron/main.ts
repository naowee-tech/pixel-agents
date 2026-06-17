import { app, BrowserWindow } from 'electron';

import type { StandaloneHandle } from '../../server/src/standalone.js';
import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import { STATE_NAMESPACE } from './config.js';
import { createNativeBridge } from './nativeBridge.js';
import { createMainWindow } from './window.js';

let handle: StandaloneHandle | null = null;
let win: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

/** dist/ root: electron-main.js is bundled to dist/, so __dirname === dist/. */
function distRoot(): string {
  return __dirname;
}

async function boot(): Promise<void> {
  const bridge = createNativeBridge({
    getWindow: () => win,
    broadcast: (m) => handle?.store.broadcast(m),
  });
  handle = await startStandaloneServer({
    distRoot: distRoot(),
    port: 0,
    namespace: STATE_NAMESPACE,
    hostCallbacks: bridge,
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

if (gotLock) {
  app.whenReady().then(boot).catch((err) => {
    console.error('[Pixel Agents] Failed to start:', err);
    app.quit();
  });
}

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
