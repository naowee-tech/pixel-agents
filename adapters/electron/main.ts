import { app, BrowserWindow, dialog } from 'electron';

import { claudeProvider } from '../../server/src/providers/index.js';
import type { StandaloneHandle } from '../../server/src/standalone.js';
import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import { STATE_NAMESPACE } from './config.js';
import { applyAppMenu } from './menu.js';
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

/** Re-scope scanning to a single project folder chosen via a native dialog. */
async function filterToFolder(): Promise<void> {
  if (!handle) return;
  const res = await dialog.showOpenDialog(win ?? undefined, { properties: ['openDirectory'] });
  if (res.canceled || res.filePaths.length === 0) return;
  const dirs = claudeProvider.getSessionDirs?.(res.filePaths[0]);
  if (!dirs || !dirs[0]) return;
  handle.runtime.watchAllSessions.current = false;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', false);
  handle.runtime.startProjectScan(dirs[0]);
  handle.runtime.startExternalScanning(dirs[0]);
}

/** Restore machine-wide scanning (show agents from all projects). */
function clearFilter(): void {
  if (!handle) return;
  handle.runtime.watchAllSessions.current = true;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', true);
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

  // Default to global scope (machine-wide) for the native app.
  handle.runtime.watchAllSessions.current = true;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', true);

  // Reuse the single bridge created above for export/import.
  applyAppMenu({
    onFilterToFolder: () => void filterToFolder(),
    onClearFilter: clearFilter,
    onExport: () => void bridge.onExportLayout?.(),
    onImport: () => void bridge.onImportLayout?.(),
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
