import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadExternalCharacterSprites,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeCharacterSprites,
  mergeLoadedAssets,
} from './assetLoader.js';
import type { AssetCache, HostCallbacks } from './clientMessageHandler.js';
import { readConfig } from './configPersistence.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { claudeProvider, copyHookScript } from './providers/index.js';
import type { ServerConfig } from './server.js';
import { PixelAgentsServer } from './server.js';

export interface StandaloneHandle {
  server: PixelAgentsServer;
  runtime: AgentRuntime;
  store: AgentStateStore;
  adapter: FileStateAdapter;
  config: ServerConfig;
  distRoot: string;
}

export interface StartStandaloneOptions {
  /** Directory containing webview/, assets/, hooks/ (the build `dist/`). */
  distRoot: string;
  host?: string;
  /** 0 = auto-assign. Default 3100 (CLI), Electron passes 0. */
  port?: number;
  namespace?: 'standalone' | 'electron';
  /** Native host callbacks (Electron file dialogs, open folder). */
  hostCallbacks?: HostCallbacks;
}

/**
 * Boot the Pixel Agents server in standalone mode (SPA + WebSocket + hooks +
 * session scanning). Shared by the CLI and the Electron app.
 */
export async function startStandaloneServer(
  opts: StartStandaloneOptions,
): Promise<StandaloneHandle> {
  const { distRoot } = opts;
  const staticDir = path.join(distRoot, 'webview');

  const assetCache: AssetCache = {
    characters: await loadCharacterSprites(distRoot),
    floorTiles: await loadFloorTiles(distRoot).then((t) => t?.sprites ?? null),
    wallTiles: await loadWallTiles(distRoot).then((t) => t?.sets ?? null),
    furniture: await loadFurnitureAssets(distRoot),
    defaultLayout: loadDefaultLayout(distRoot),
  };

  // Reload furniture + character assets (bundled + every external dir) and push
  // the freshly merged sets to the client. Used when external asset dirs change.
  // NOTE: assetLoader's send* helpers take a vscode.Webview and call
  // webview.postMessage(...). Rather than fake that shape with `as never`, we
  // emit the real messages directly with the same type fields those helpers use
  // (characterSpritesLoaded / furnitureAssetsLoaded).
  const reloadAssets = async (send: (m: Record<string, unknown>) => void): Promise<void> => {
    const cfg = readConfig();
    let chars = await loadCharacterSprites(distRoot);
    let furniture = await loadFurnitureAssets(distRoot);
    for (const dir of cfg.externalAssetDirectories) {
      const exChars = await loadExternalCharacterSprites(dir);
      if (exChars) chars = chars ? mergeCharacterSprites(chars, exChars) : exChars;
      const exFurn = await loadFurnitureAssets(dir);
      if (exFurn) furniture = furniture ? mergeLoadedAssets(furniture, exFurn) : exFurn;
    }
    if (chars) {
      send({ type: 'characterSpritesLoaded', characters: chars.characters });
    }
    if (furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: furniture.catalog,
        sprites: Object.fromEntries(furniture.sprites),
      });
    }
  };

  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: opts.namespace ?? 'standalone' });
  store.setAdapter(adapter);

  const runtime = new AgentRuntime(store, claudeProvider);
  const server = new PixelAgentsServer();
  server.onHookEvent((providerId, event) => runtime.handleHookEvent(providerId, event));

  let currentConfig: { port: number; token: string } | null = null;
  const onSetHooksEnabled = async (enabled: boolean): Promise<void> => {
    if (!currentConfig) return;
    if (enabled) {
      await claudeProvider.installHooks(
        `http://127.0.0.1:${currentConfig.port}`,
        currentConfig.token,
      );
      copyHookScript(distRoot);
    } else {
      await claudeProvider.uninstallHooks();
    }
  };

  const config = await server.start({
    store,
    runtime,
    embedded: false,
    host: opts.host ?? '127.0.0.1',
    port: opts.port ?? 3100,
    staticDir,
    assetCache,
    onSetHooksEnabled,
    hostId: opts.namespace === 'electron' ? 'electron' : 'standalone',
    hostCallbacks: opts.hostCallbacks,
    reloadAssets,
  });
  currentConfig = { port: config.port, token: config.token };

  runtime.hooksEnabled.current = adapter.getSetting('pixel-agents.hooksEnabled', true);
  runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

  if (runtime.hooksEnabled.current) {
    try {
      await claudeProvider.installHooks(`http://127.0.0.1:${config.port}`, config.token);
      copyHookScript(distRoot);
    } catch (err) {
      console.error('[Pixel Agents] Failed to install hooks:', err);
    }
  }

  const cwd = process.cwd();
  const dirs = claudeProvider.getSessionDirs?.(cwd);
  if (dirs && dirs[0]) {
    runtime.startProjectScan(dirs[0]);
    runtime.startExternalScanning(dirs[0]);
    runtime.startStaleCheck();
  }

  return { server, runtime, store, adapter, config, distRoot };
}

export function stopStandalone(handle: StandaloneHandle): void {
  handle.runtime.dispose();
  handle.server.stop();
}
