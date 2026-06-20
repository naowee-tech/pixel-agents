import { app, BrowserWindow, dialog } from 'electron';

import { claudeProvider } from '../../server/src/providers/index.js';
import type { StandaloneHandle } from '../../server/src/standalone.js';
import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import { attachAttention } from './attention.js';
import { STATE_NAMESPACE } from './config.js';
import { applyAppMenu } from './menu.js';
import { createNativeBridge } from './nativeBridge.js';
import { createTerminalBridge } from './terminalBridge.js';
import { createTerminalManager } from './terminalManager.js';
import { createWaitingTray } from './tray.js';
import { createMainWindow } from './window.js';

let handle: StandaloneHandle | null = null;
let win: BrowserWindow | null = null;
let tray: { setCount: (n: number) => void; destroy: () => void } | null = null;
let detachAttention: (() => void) | null = null;
let terminal: ReturnType<typeof createTerminalManager> | null = null;

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

/**
 * Set up the server, bridge, tray, attention, and menu exactly ONCE. On macOS
 * the process survives window close (window-all-closed does not quit), so a dock
 * re-activate must not re-run any of this — guard on `handle`.
 */
async function ensureServer(): Promise<void> {
  if (handle) return;

  terminal = createTerminalManager();
  const terminalBridge = createTerminalBridge({
    manager: terminal,
    broadcast: (m) => handle?.store.broadcast(m),
    onExit: (id) => handle?.runtime.markTerminalDetached(id),
  });
  const bridge = {
    ...createNativeBridge({
      getWindow: () => win,
      broadcast: (m) => handle?.store.broadcast(m),
    }),
    ...terminalBridge,
  };
  handle = await startStandaloneServer({
    distRoot: distRoot(),
    port: 0,
    namespace: STATE_NAMESPACE,
    hostCallbacks: bridge,
  });

  // Default to global scope (machine-wide) for the native app.
  handle.runtime.watchAllSessions.current = true;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', true);

  // Fire native OS attention (notification, dock bounce/badge) when agents wait.
  tray = createWaitingTray(handle.adapter);
  detachAttention = attachAttention({
    store: handle.store,
    adapter: handle.adapter,
    getWindow: () => win,
    onCountChange: (n) => tray?.setCount(n),
  });

  // Reuse the single bridge created above for export/import.
  applyAppMenu({
    onFilterToFolder: () => void filterToFolder(),
    onClearFilter: clearFilter,
    onExport: () => void bridge.onExportLayout?.(),
    onImport: () => void bridge.onImportLayout?.(),
  });
}

/** Create (or re-show) the main window. Safe to call repeatedly. */
function openWindow(): void {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = createMainWindow({
    url: `http://127.0.0.1:${handle!.config.port}`,
    getSetting: (key, def) => handle!.adapter.getSetting(key, def),
    setSetting: (key, val) => handle!.adapter.setSetting(key, val),
  });
  win.on('closed', () => {
    win = null;
  });
}

async function boot(): Promise<void> {
  await ensureServer();
  openWindow();
}

if (gotLock) {
  app
    .whenReady()
    .then(boot)
    .catch((err) => {
      console.error('[Pixel Agents] Failed to start:', err);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // The server is already running; only (re)open the window. Do NOT re-boot.
  if (handle) openWindow();
});

app.on('before-quit', () => {
  detachAttention?.();
  detachAttention = null;
  tray?.destroy();
  tray = null;
  terminal?.killAll();
  terminal = null;
  if (handle) stopStandalone(handle);
  handle = null;
});
