import type { BrowserWindow } from 'electron';
import { dialog, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { HostCallbacks } from '../../server/src/clientMessageHandler.js';
import { readConfig, writeConfig } from '../../server/src/configPersistence.js';
import { readLayoutFromFile, writeLayoutToFile } from '../../server/src/layoutPersistence.js';

export interface NativeBridgeDeps {
  getWindow: () => BrowserWindow | null;
  /** Push a ServerMessage to all connected webview clients (store.broadcast). */
  broadcast: (message: Record<string, unknown>) => void;
}

export function createNativeBridge(deps: NativeBridgeDeps): HostCallbacks {
  const win = (): BrowserWindow | undefined => deps.getWindow() ?? undefined;

  return {
    async onExportLayout() {
      const layout = readLayoutFromFile();
      if (!layout) return;
      const res = await dialog.showSaveDialog(win() as BrowserWindow, {
        defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return;
      fs.writeFileSync(res.filePath, JSON.stringify(layout, null, 2), 'utf-8');
    },

    async onImportLayout() {
      const res = await dialog.showOpenDialog(win() as BrowserWindow, {
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      });
      if (res.canceled || res.filePaths.length === 0) return;
      try {
        const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
        const imported = JSON.parse(raw) as Record<string, unknown>;
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) return;
        writeLayoutToFile(imported);
        deps.broadcast({ type: 'layoutLoaded', layout: imported });
      } catch {
        // ignore malformed file
      }
    },

    async onPickAssetDir() {
      const res = await dialog.showOpenDialog(win() as BrowserWindow, {
        properties: ['openDirectory'],
      });
      if (res.canceled || res.filePaths.length === 0) return;
      const newPath = res.filePaths[0];
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      deps.broadcast({
        type: 'externalAssetDirectoriesUpdated',
        dirs: cfg.externalAssetDirectories,
      });
    },

    onOpenPath(dir: string) {
      void shell.openPath(dir);
    },
  };
}
