# Electron Native App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Pixel Agents as a native macOS desktop app (Electron) that wraps the existing standalone server in-process, reusing the webview-ui SPA over WebSocket, plus native OS attention when an agent waits for confirmation.

**Architecture:** Electron's main process boots the existing standalone Fastify server in-process (`startStandaloneServer`), opens a `BrowserWindow` at `http://127.0.0.1:<port>`, and the unchanged webview-ui connects via its existing `WebSocketTransport`. Native dialogs (export/import/asset-dir) are filled via host callbacks passed into the server; native attention (`attention.ts`) subscribes directly to the in-process `AgentStateStore`.

**Tech Stack:** TypeScript, Electron, electron-builder, Fastify (existing), esbuild (existing bundler), Vitest (server + electron unit tests), Playwright (E2E), React 19 (webview-ui, minimal touch).

## Global Constraints

- TypeScript: NO `enum` (use `as const` objects); `import type` for type-only imports (verbatimModuleSyntax); relative imports MUST end in `.js`; obey `noUnusedLocals`/`noUnusedParameters`.
- Server unit tests use **Vitest** (`cd server && npx vitest run <file>`). Webview asset tests use node:test. Electron unit tests use Vitest in `adapters/electron`.
- Server binds `127.0.0.1` only. The `/ws` WebSocket has NO auth in standalone/electron mode (already the case).
- `messages.ts` is AUTO-GENERATED from `core/asyncapi.yaml`. Never hand-edit `core/src/messages.ts`; edit the yaml and run `npm run asyncapi:generate`.
- Electron windows: `contextIsolation: true`, `nodeIntegration: false`.
- App-scoped persistence uses `FileStateAdapter({ namespace: 'electron' })`. `layout.json`/`config.json` stay shared across hosts.
- Do NOT uninstall Claude hooks on quit.
- Do NOT modify webview-ui except `SettingsModal.tsx` and the settings message plumbing (Task 10).
- macOS is the only build target in this plan (Windows is a later etapa).
- Every git commit message ends with a trailing line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work happens on branch `feat/electron-native-app` (already created).

---

## File Structure

**Server (`server/src/`)**
- `standalone.ts` (new) — reusable bootstrap: `startStandaloneServer` / `stopStandalone` / `HostCallbacks` / `StandaloneHandle`.
- `cli.ts` (modify) — thin wrapper around `standalone.ts`.
- `clientMessageHandler.ts` (modify) — host callbacks + `host` field + `setNotifySettings` + reload-and-send assets.
- `server.ts` (modify) — forward `hostCallbacks` + `host` through `start()`.
- `httpServer.ts` (modify) — forward `hostCallbacks` + `host` into the WS client-message context.

**Core (`core/`)**
- `asyncapi.yaml` (modify) — add `host`/`notify` to `SettingsLoaded`, add `NotifySettings`, add `SetNotifySettings`.
- `src/messages.ts` (regenerated, do not hand-edit).

**Electron adapter (`adapters/electron/`, all new)**
- `config.ts` — constants (namespace, setting keys, window-state key, defaults).
- `main.ts` — app entry: lifecycle, single-instance, boot server, create window, wire bridge/attention/tray.
- `window.ts` — BrowserWindow creation + window-state persistence.
- `menu.ts` — native menu (filter to folder, clear filter, export/import).
- `nativeBridge.ts` — `HostCallbacks` implementation via Electron `dialog`/`shell`.
- `attention.ts` — native attention signals from store events.
- `tray.ts` — menubar/tray waiting-count.
- `package.json`, `tsconfig.json`, `vitest.config.ts`.

**Build/root**
- `esbuild.js` (modify) — add `buildElectronMain()` → `dist/electron-main.js`.
- `package.json` (modify) — `build:electron`, `dev:electron`, electron-builder config.

**webview-ui (`webview-ui/src/`)**
- `components/SettingsModal.tsx` (modify) — Native Alerts section (Electron only).
- `hooks/useExtensionMessages.ts` (modify) — read `host`/`notify` from `settingsLoaded`.
- `App.tsx` (modify) — thread `host`/`notify` into `SettingsModal`.

---

## Task 1: Server bootstrap refactor (`standalone.ts`)

Behavior-preserving extraction of `cli.ts`'s startup logic into a reusable module so Electron and the CLI share it.

**Files:**
- Create: `server/src/standalone.ts`
- Modify: `server/src/cli.ts`
- Test: `server/__tests__/standalone.test.ts`

**Interfaces:**
- Produces:
  - `startStandaloneServer(opts: StartStandaloneOptions): Promise<StandaloneHandle>`
  - `stopStandalone(handle: StandaloneHandle): void`
  - `interface StandaloneHandle { server: PixelAgentsServer; runtime: AgentRuntime; store: AgentStateStore; adapter: FileStateAdapter; config: ServerConfig; distRoot: string }`
  - `interface StartStandaloneOptions { distRoot: string; host?: string; port?: number; namespace?: 'standalone' | 'electron' }`
- Consumes (existing): `AgentRuntime`, `AgentStateStore`, `FileStateAdapter`, `PixelAgentsServer`, `claudeProvider`, `copyHookScript`, asset loaders from `./assetLoader.js`, `AssetCache` from `./clientMessageHandler.js`, `ServerConfig` from `./server.js`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/standalone.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

const { startStandaloneServer, stopStandalone } = await import('../src/standalone.js');

describe('startStandaloneServer', () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-standalone-'));
  });
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('starts a server bound to an auto-assigned port and answers /api/health', async () => {
    const handle = await startStandaloneServer({
      distRoot: path.join(__dirname, '..', '..', 'dist'),
      port: 0,
      namespace: 'electron',
    });
    try {
      expect(handle.config.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${handle.config.port}/api/health`);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    } finally {
      stopStandalone(handle);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/standalone.test.ts`
Expected: FAIL — cannot resolve `../src/standalone.js` (module does not exist).

- [ ] **Step 3: Create `server/src/standalone.ts`**

```ts
import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
} from './assetLoader.js';
import type { AssetCache } from './clientMessageHandler.js';
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
```

- [ ] **Step 4: Rewrite `server/src/cli.ts` as a thin wrapper**

Replace the entire file with:

```ts
#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Thin wrapper around startStandaloneServer (server/src/standalone.ts).
 */

import * as path from 'path';

import { startStandaloneServer, stopStandalone } from './standalone.js';

interface CliArgs {
  port: number;
  host: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3100, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: 3100)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await startStandaloneServer({
    distRoot: __dirname,
    host: args.host,
    port: args.port,
    namespace: 'standalone',
  });

  console.log(`\n  Pixel Agents server running at http://${args.host}:${handle.config.port}\n`);

  function shutdown(): void {
    console.log('\nShutting down...');
    stopStandalone(handle);
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Note: `__dirname` resolves at runtime to `dist/` (the bundled CLI location), matching the original behavior.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd .. && npm run build && cd server && npx vitest run __tests__/standalone.test.ts && npx vitest run`
Expected: standalone test PASSES; all existing server tests stay green.

- [ ] **Step 6: Type-check + lint**

Run: `cd .. && npm run check-types && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/standalone.ts server/src/cli.ts server/__tests__/standalone.test.ts
git commit -m "refactor(server): extract reusable startStandaloneServer from cli"
```

---

## Task 2: Host callbacks + `host` field + reload-and-send assets

Wire the standalone client-message gaps (`exportLayout`, `importLayout`, `addExternalAssetDirectory` without `path`, `openSessionsFolder`) to host callbacks, and add the `host` field to `settingsLoaded`. Also add `host` to the asyncapi schema.

**Files:**
- Modify: `core/asyncapi.yaml`, `server/src/clientMessageHandler.ts`, `server/src/server.ts`, `server/src/httpServer.ts`, `server/src/standalone.ts`
- Regenerated: `core/src/messages.ts`
- Test: `server/__tests__/clientMessageHandler.test.ts` (new)

**Interfaces:**
- Produces:
  - `interface HostCallbacks { onExportLayout?: () => Promise<void> | void; onImportLayout?: () => Promise<void> | void; onPickAssetDir?: () => Promise<void> | void; onOpenPath?: (dir: string) => void }` (exported from `clientMessageHandler.ts`)
  - `ClientMessageContext` gains `host?: 'vscode' | 'standalone' | 'electron'` and `hostCallbacks?: HostCallbacks` and `reloadAssets?: (send: (m: Record<string, unknown>) => void) => Promise<void>`
  - `StartStandaloneOptions` gains `hostCallbacks?: HostCallbacks`
  - `settingsLoaded` message gains optional `host?: string`
- Consumes: Task 1 `startStandaloneServer`.

- [ ] **Step 1: Add `host` to `SettingsLoaded` in `core/asyncapi.yaml`**

In `core/asyncapi.yaml`, inside `SettingsLoaded.properties` (after the `externalAssetDirectories` block, around line 539), add:

```yaml
        host:
          type: string
          description: Host runtime identifier ('vscode' | 'standalone' | 'electron').
```

Leave `host` out of the `required:` list (it stays optional).

- [ ] **Step 2: Regenerate messages + verify**

Run: `cd .. && npm run asyncapi:generate`
Then confirm `core/src/messages.ts` `SettingsLoaded` now has `host?: string`.
Run: `grep -n "host" core/src/messages.ts`
Expected: shows `host?: string;` inside the `SettingsLoaded` interface.

- [ ] **Step 3: Write the failing test**

Create `server/__tests__/clientMessageHandler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  const store = new AgentStateStore();
  return {
    store,
    runtime: undefined,
    cache: null,
    host: 'electron' as const,
    ...overrides,
  };
}

describe('handleClientMessage host callbacks', () => {
  it('invokes onExportLayout for exportLayout', () => {
    const onExportLayout = vi.fn();
    const sent: Record<string, unknown>[] = [];
    handleClientMessage(
      { type: 'exportLayout' },
      (m) => sent.push(m),
      makeCtx({ hostCallbacks: { onExportLayout } }),
    );
    expect(onExportLayout).toHaveBeenCalledOnce();
  });

  it('invokes onPickAssetDir for addExternalAssetDirectory without a path', () => {
    const onPickAssetDir = vi.fn();
    handleClientMessage(
      { type: 'addExternalAssetDirectory' },
      () => {},
      makeCtx({ hostCallbacks: { onPickAssetDir } }),
    );
    expect(onPickAssetDir).toHaveBeenCalledOnce();
  });

  it('includes host in the settingsLoaded payload on webviewReady', () => {
    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), makeCtx());
    const settings = sent.find((m) => m.type === 'settingsLoaded');
    expect(settings?.host).toBe('electron');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts`
Expected: FAIL — `onExportLayout` not called / `host` undefined (callbacks not wired yet).

- [ ] **Step 5: Extend `ClientMessageContext` and handlers in `server/src/clientMessageHandler.ts`**

Add the `HostCallbacks` interface and extend the context (place near the top, after the existing `SetHooksEnabledSideEffect` type):

```ts
export interface HostCallbacks {
  onExportLayout?: () => Promise<void> | void;
  onImportLayout?: () => Promise<void> | void;
  onPickAssetDir?: () => Promise<void> | void;
  onOpenPath?: (dir: string) => void;
}
```

Update `ClientMessageContext`:

```ts
export interface ClientMessageContext {
  store: AgentStateStore;
  runtime?: AgentRuntime;
  cache: AssetCache | null;
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  host?: 'vscode' | 'standalone' | 'electron';
  hostCallbacks?: HostCallbacks;
  /** Reloads furniture + character assets and pushes them to the client. */
  reloadAssets?: (send: (m: Record<string, unknown>) => void) => Promise<void>;
}
```

In the `switch (msg.type)` block, replace the `addExternalAssetDirectory` case body's start to pick a folder natively when no path is given, and add the new cases before `default`:

```ts
    case 'exportLayout':
      void ctx.hostCallbacks?.onExportLayout?.();
      break;

    case 'importLayout':
      void ctx.hostCallbacks?.onImportLayout?.();
      break;

    case 'openSessionsFolder': {
      const dirs = claudeProvider.getSessionDirs?.(process.cwd());
      if (dirs && dirs[0]) ctx.hostCallbacks?.onOpenPath?.(dirs[0]);
      break;
    }
```

Replace the existing `addExternalAssetDirectory` case so a missing `path` delegates to the host picker:

```ts
    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) {
        void ctx.hostCallbacks?.onPickAssetDir?.();
        break;
      }
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      await ctx.reloadAssets?.(send);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }
```

NOTE: `handleClientMessage` is currently `void`-returning and synchronous. Change its signature to `async` (`export async function handleClientMessage(...): Promise<void>`) because of the `await ctx.reloadAssets`. Update the `removeExternalAssetDirectory` case to also `await ctx.reloadAssets?.(send)` before sending the updated dirs. Add `import { claudeProvider } from './providers/index.js';` if not already imported (it is imported already).

In `handleWebviewReady`, add `host` to the `settingsLoaded` payload:

```ts
  send({
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion: adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '',
    extensionVersion: process.env.PIXEL_AGENTS_VERSION ?? '',
    watchAllSessions,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    hooksEnabled,
    hooksInfoShown: adapter?.getSetting(KEY_HOOKS_INFO_SHOWN, false) ?? false,
    externalAssetDirectories: cfg.externalAssetDirectories,
    host: ctx.host ?? 'standalone',
  });
```

- [ ] **Step 6: Forward `host`/`hostCallbacks`/`reloadAssets` through the WS layer**

In `server/src/httpServer.ts`, extend `HttpServerOptions`:

```ts
  host?: string;
  hostId?: 'vscode' | 'standalone' | 'electron';
  hostCallbacks?: import('./clientMessageHandler.js').HostCallbacks;
  reloadAssets?: (send: (m: Record<string, unknown>) => void) => Promise<void>;
```

(`host` already exists for bind address — keep it; add the distinct `hostId` to avoid collision.)

In `registerWebSocketRoute`, update the `handleClientMessage` call (it must now be awaited):

```ts
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        void handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          host: options.hostId,
          hostCallbacks: options.hostCallbacks,
          reloadAssets: options.reloadAssets,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });
```

In `server/src/server.ts`, add to `start()` options and forward to `createHttpServer`:

```ts
    hostId?: 'vscode' | 'standalone' | 'electron';
    hostCallbacks?: import('./clientMessageHandler.js').HostCallbacks;
    reloadAssets?: (send: (m: Record<string, unknown>) => void) => Promise<void>;
```

and in the `createHttpServer({ ... })` call add: `hostId: options?.hostId, hostCallbacks: options?.hostCallbacks, reloadAssets: options?.reloadAssets,`.

- [ ] **Step 7: Pass host info from `standalone.ts` + add reload-and-send**

In `server/src/standalone.ts`, add `hostCallbacks?: HostCallbacks` to `StartStandaloneOptions` (import the type from `./clientMessageHandler.js`). Build a `reloadAssets` closure and pass everything into `server.start`:

```ts
import type { HostCallbacks } from './clientMessageHandler.js';
import { readConfig } from './configPersistence.js';
import {
  loadExternalCharacterSprites,
  mergeCharacterSprites,
  mergeLoadedAssets,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
} from './assetLoader.js';
```

After computing `assetCache`, define:

```ts
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
    if (chars) sendCharacterSpritesToWebview({ postMessage: send } as never, chars);
    if (furniture) sendAssetsToWebview({ postMessage: send } as never, furniture);
  };
```

NOTE: `sendCharacterSpritesToWebview`/`sendAssetsToWebview` expect a `{ postMessage }` shape (a VS Code webview). Verify their signature in `assetLoader.ts`; if they take a raw `send(msg)` function instead, pass `send` directly. Adjust the adapter object accordingly so a real message is emitted with the same `type` fields (`characterSpritesLoaded`, `furnitureAssetsLoaded`).

In the `server.start({ ... })` call add:

```ts
    hostId: opts.namespace === 'electron' ? 'electron' : 'standalone',
    hostCallbacks: opts.hostCallbacks,
    reloadAssets,
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts && npx vitest run`
Expected: new test PASSES; existing tests green.

- [ ] **Step 9: Type-check + lint, then commit**

Run: `cd .. && npm run check-types && npm run lint`

```bash
git add core/asyncapi.yaml core/src/messages.ts server/src/clientMessageHandler.ts server/src/server.ts server/src/httpServer.ts server/src/standalone.ts server/__tests__/clientMessageHandler.test.ts
git commit -m "feat(server): host callbacks, host field, reload-and-send for standalone"
```

---

## Task 3: Electron scaffold + minimal runnable app

First runnable milestone: an Electron app that boots the server in-process and shows the office.

**Files:**
- Create: `adapters/electron/package.json`, `adapters/electron/tsconfig.json`, `adapters/electron/vitest.config.ts`, `adapters/electron/config.ts`, `adapters/electron/main.ts`
- Modify: `esbuild.js`, root `package.json`

**Interfaces:**
- Consumes: `startStandaloneServer`/`stopStandalone`/`StandaloneHandle` (Task 1).
- Produces: `dist/electron-main.js` (bundled main process); `npm run dev:electron`.

- [ ] **Step 1: Create `adapters/electron/config.ts`**

```ts
/** Electron adapter constants. */
export const APP_NAME = 'Pixel Agents';
export const STATE_NAMESPACE = 'electron' as const;

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
```

- [ ] **Step 2: Create `adapters/electron/main.ts` (minimal)**

```ts
import { app, BrowserWindow } from 'electron';
import * as path from 'path';

import { startStandaloneServer, stopStandalone } from '../../server/src/standalone.js';
import type { StandaloneHandle } from '../../server/src/standalone.js';
import { APP_NAME, STATE_NAMESPACE } from './config.js';

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
    backgroundColor: '#1e1e2e',
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
```

(Remove the `void path;` line and the `path` import if your linter flags it; `path` is used in later tasks.)

- [ ] **Step 3: Create `adapters/electron/package.json`**

```json
{
  "name": "pixel-agents-electron",
  "private": true,
  "version": "0.0.0",
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `cd adapters/electron && npm install && cd ../..`

- [ ] **Step 4: Create `adapters/electron/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["node"],
    "noEmit": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 5: Create `adapters/electron/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 6: Add `buildElectronMain()` to `esbuild.js`**

After `buildCli()` (around line 132), add:

```js
/** Bundle the Electron main process entry point. */
async function buildElectronMain() {
  await esbuild.build({
    entryPoints: ['adapters/electron/main.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    platform: 'node',
    outfile: 'dist/electron-main.js',
    external: ['electron', 'fastify', '@fastify/websocket', '@fastify/static', '@fastify/cors'],
    define: versionDefine,
    logLevel: 'silent',
  });
  if (!production) {
    console.log('[build] Electron main bundled: dist/electron-main.js');
  }
}
```

And call it inside `main()` right after `await buildCli();`:

```js
    await buildCli();
    await buildElectronMain();
```

- [ ] **Step 7: Add root scripts to `package.json`**

In root `package.json` `scripts`, add:

```json
    "build:electron": "npm run compile && electron-builder --mac",
    "dev:electron": "npm run compile && electron dist/electron-main.js"
```

- [ ] **Step 8: Run the app manually**

Run: `npm run dev:electron`
Expected: an Electron window opens showing the Pixel Agents office (empty office on first run). Closing it quits the app (macOS: app stays in dock; Cmd+Q quits).

- [ ] **Step 9: Type-check + lint, then commit**

Run: `npm run check-types && npm run lint`
NOTE: add `adapters/electron` to the `lint` script's eslint targets: change `"lint": "eslint adapters/vscode server core && cd webview-ui && eslint ."` to `"lint": "eslint adapters/vscode adapters/electron server core && cd webview-ui && eslint ."` (and the same for `lint:fix`/`format`/`format:check`).

```bash
git add adapters/electron esbuild.js package.json package-lock.json
git commit -m "feat(electron): scaffold app that boots server in-process and shows office"
```

---

## Task 4: Window state persistence

Persist and restore window bounds across launches.

**Files:**
- Create: `adapters/electron/window.ts`, `adapters/electron/window.test.ts`
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Produces:
  - `createMainWindow(opts: { url: string; getSetting: GetSetting; setSetting: SetSetting }): BrowserWindow`
  - `type GetSetting = <T>(key: string, def: T) => T; type SetSetting = <T>(key: string, val: T) => void;`
  - `interface WindowBounds { width: number; height: number; x?: number; y?: number }`
- Consumes: `WINDOW_STATE_KEY` from `config.ts`; the `FileStateAdapter` exposed via `handle.adapter` (`getSetting`/`setSetting`).

- [ ] **Step 1: Write the failing test**

Create `adapters/electron/window.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  class FakeWindow {
    opts: unknown;
    handlers: Record<string, () => void> = {};
    constructor(opts: unknown) {
      this.opts = opts;
    }
    loadURL = vi.fn();
    on(event: string, cb: () => void) {
      this.handlers[event] = cb;
    }
    getBounds() {
      return { width: 800, height: 600, x: 10, y: 20 };
    }
  }
  return { BrowserWindow: FakeWindow };
});

const { sanitizeBounds } = await import('./window.js');

describe('sanitizeBounds', () => {
  it('falls back to defaults when bounds are missing', () => {
    expect(sanitizeBounds(undefined)).toEqual({ width: 1100, height: 720 });
  });

  it('clamps absurdly small sizes up to the minimum', () => {
    const b = sanitizeBounds({ width: 50, height: 50, x: 0, y: 0 });
    expect(b.width).toBeGreaterThanOrEqual(600);
    expect(b.height).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters/electron && npx vitest run window.test.ts`
Expected: FAIL — cannot resolve `./window.js`.

- [ ] **Step 3: Create `adapters/electron/window.ts`**

```ts
import { BrowserWindow } from 'electron';

import { APP_NAME, WINDOW_STATE_KEY } from './config.js';

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
    backgroundColor: '#1e1e2e',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const persist = (): void => {
    opts.setSetting<WindowBounds>(WINDOW_STATE_KEY, win.getBounds());
  };
  win.on('close', persist);

  void win.loadURL(opts.url);
  return win;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd adapters/electron && npx vitest run window.test.ts`
Expected: PASS.

- [ ] **Step 5: Use `createMainWindow` in `main.ts`**

Replace the inline `new BrowserWindow(...)` + `loadURL` in `boot()` with:

```ts
import { createMainWindow } from './window.js';
// ...
  win = createMainWindow({
    url: `http://127.0.0.1:${handle.config.port}`,
    getSetting: (key, def) => handle!.adapter.getSetting(key, def),
    setSetting: (key, val) => handle!.adapter.setSetting(key, val),
  });
  win.on('closed', () => {
    win = null;
  });
```

Remove the now-unused `path` import / `void path;` line if present.

- [ ] **Step 6: Manual smoke + commit**

Run: `cd ../.. && npm run dev:electron` — resize/move the window, quit (Cmd+Q), relaunch; the window restores its size/position.

```bash
git add adapters/electron/window.ts adapters/electron/window.test.ts adapters/electron/main.ts
git commit -m "feat(electron): persist and restore window bounds"
```

---

## Task 5: Single-instance lock + lifecycle hardening

Ensure only one instance runs; a second launch focuses the existing window. Harden shutdown.

**Files:**
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Consumes: `boot()`, `win`, `handle` from `main.ts`.

- [ ] **Step 1: Add the single-instance lock at the top of `main.ts`**

Immediately after the imports and module-level `let` declarations, add:

```ts
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
```

Wrap the `app.whenReady().then(boot)` registration so it only runs when `gotLock` is true (move it inside the `else` block, or guard with `if (gotLock)`).

- [ ] **Step 2: Manual verification**

Run: `npm run dev:electron`. While it runs, in another terminal run `npm run dev:electron` again.
Expected: the second invocation does NOT open a new window; the first window comes to focus.

NOTE: in dev (`electron dist/electron-main.js`) the single-instance lock is keyed by the Electron binary path; verify again with the packaged app in Task 11 where the lock is keyed by the app id.

- [ ] **Step 3: Commit**

```bash
git add adapters/electron/main.ts
git commit -m "feat(electron): single-instance lock with focus-on-relaunch"
```

---

## Task 6: Native bridge (dialogs)

Implement `HostCallbacks` with Electron `dialog`/`shell` and pass them into the server.

**Files:**
- Create: `adapters/electron/nativeBridge.ts`, `adapters/electron/nativeBridge.test.ts`
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Produces: `createNativeBridge(deps: { getWindow: () => BrowserWindow | null; broadcast: (m: Record<string, unknown>) => void }): HostCallbacks`
- Consumes: `HostCallbacks` (Task 2); `readLayoutFromFile`/`writeLayoutToFile` from `server/src/layoutPersistence.js`; `readConfig`/`writeConfig` from `server/src/configPersistence.js`; `handle.store.broadcast` to push `layoutLoaded`/`externalAssetDirectoriesUpdated`.

- [ ] **Step 1: Write the failing test**

Create `adapters/electron/nativeBridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const showSaveDialog = vi.fn();
const showOpenDialog = vi.fn();
const openPath = vi.fn();

vi.mock('electron', () => ({
  dialog: { showSaveDialog, showOpenDialog },
  shell: { openPath },
}));

vi.mock('../../server/src/layoutPersistence.js', () => ({
  readLayoutFromFile: () => ({ version: 1, tiles: [] }),
  writeLayoutToFile: vi.fn(),
}));
vi.mock('../../server/src/configPersistence.js', () => ({
  readConfig: () => ({ externalAssetDirectories: [] }),
  writeConfig: vi.fn(),
}));

const fsWrite = vi.fn();
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, writeFileSync: (...a: unknown[]) => fsWrite(...a) };
});

const { createNativeBridge } = await import('./nativeBridge.js');

describe('nativeBridge', () => {
  it('onExportLayout writes the chosen file', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/layout.json' });
    const bridge = createNativeBridge({ getWindow: () => null, broadcast: vi.fn() });
    await bridge.onExportLayout?.();
    expect(fsWrite).toHaveBeenCalledWith('/tmp/layout.json', expect.any(String), 'utf-8');
  });

  it('onExportLayout does nothing when canceled', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true });
    const bridge = createNativeBridge({ getWindow: () => null, broadcast: vi.fn() });
    await bridge.onExportLayout?.();
    expect(fsWrite).not.toHaveBeenCalled();
  });
});
```

(`fsWrite` is reset between the two tests by Vitest's default isolation; if not, add `beforeEach(() => fsWrite.mockClear())`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters/electron && npx vitest run nativeBridge.test.ts`
Expected: FAIL — cannot resolve `./nativeBridge.js`.

- [ ] **Step 3: Create `adapters/electron/nativeBridge.ts`**

```ts
import { dialog, shell } from 'electron';
import type { BrowserWindow } from 'electron';
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
  const win = () => deps.getWindow() ?? undefined;

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
      deps.broadcast({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
    },

    onOpenPath(dir: string) {
      void shell.openPath(dir);
    },
  };
}
```

NOTE on asset reload after `onPickAssetDir`: the client also needs the new sprites. `onPickAssetDir` broadcasts the updated dir list; to push the actual sprites, the renderer can re-request, or extend this to call the same reload-and-send used in Task 2. For MVP, broadcasting `externalAssetDirectoriesUpdated` plus the existing add-with-path WS path (which calls `reloadAssets`) covers it — verify visually in Task 11 smoke.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd adapters/electron && npx vitest run nativeBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the bridge into `main.ts`**

In `boot()`, create the bridge BEFORE starting the server, and pass it in:

```ts
import { createNativeBridge } from './nativeBridge.js';
// ...
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
```

(The `broadcast` closure reads `handle` lazily, so capturing it before assignment is fine.)

- [ ] **Step 6: Manual smoke + commit**

Run: `cd ../.. && npm run dev:electron`. In Settings: Export Layout → native save dialog appears; Import Layout → native open dialog; Add Asset Directory → native folder picker.

```bash
git add adapters/electron/nativeBridge.ts adapters/electron/nativeBridge.test.ts adapters/electron/main.ts
git commit -m "feat(electron): native dialogs for export/import/asset-dir/open-folder"
```

---

## Task 7: Native menu + folder filter

Add an app menu with a folder filter that re-scopes scanning, plus menu shortcuts for export/import.

**Files:**
- Create: `adapters/electron/menu.ts`
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Produces: `buildAppMenu(deps: MenuDeps): Menu` where `interface MenuDeps { onFilterToFolder: () => void; onClearFilter: () => void; onExport: () => void; onImport: () => void }`
- Consumes: `handle.runtime` (`watchAllSessions`, `startProjectScan`, `startExternalScanning`), `claudeProvider.getSessionDirs`, `dialog`.

- [ ] **Step 1: Create `adapters/electron/menu.ts`**

```ts
import { app, Menu } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

import { APP_NAME } from './config.js';

export interface MenuDeps {
  onFilterToFolder: () => void;
  onClearFilter: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function buildAppMenu(deps: MenuDeps): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Office',
      submenu: [
        { label: 'Filter to Folder…', click: () => deps.onFilterToFolder() },
        { label: 'Clear Filter (Show All)', click: () => deps.onClearFilter() },
        { type: 'separator' },
        { label: 'Export Layout…', click: () => deps.onExport() },
        { label: 'Import Layout…', click: () => deps.onImport() },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

export function applyAppMenu(deps: MenuDeps): void {
  Menu.setApplicationMenu(buildAppMenu(deps));
  void app; // app referenced to keep import meaningful across roles
}
```

- [ ] **Step 2: Wire the menu + filter logic into `main.ts`**

Add a folder-filter implementation and apply the menu after `boot()`:

```ts
import { dialog } from 'electron';
import { claudeProvider } from '../../server/src/providers/index.js';
import { applyAppMenu } from './menu.js';
// ...

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

function clearFilter(): void {
  if (!handle) return;
  handle.runtime.watchAllSessions.current = true;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', true);
}
```

At the end of `boot()`, after the window is created:

```ts
  // Default to global scope (machine-wide) for the native app.
  handle.runtime.watchAllSessions.current = true;
  handle.adapter.setSetting('pixel-agents.watchAllSessions', true);

  const bridge2 = createNativeBridge({ getWindow: () => win, broadcast: (m) => handle?.store.broadcast(m) });
  applyAppMenu({
    onFilterToFolder: () => void filterToFolder(),
    onClearFilter: clearFilter,
    onExport: () => void bridge2.onExportLayout?.(),
    onImport: () => void bridge2.onImportLayout?.(),
  });
```

(Reuse the `bridge` already created earlier instead of `bridge2` — keep a single `const bridge` in scope and reference it in both `startStandaloneServer` and `applyAppMenu`.)

- [ ] **Step 3: Manual verification**

Run: `cd ../.. && npm run dev:electron`. Menu "Office → Filter to Folder…" → pick a project folder → only that project's agents show. "Clear Filter" → all sessions again. Verify by running `claude` in two different project folders.

NOTE: confirm during smoke that global mode (`watchAllSessions=true`) actually surfaces agents from multiple projects. If the runtime needs an explicit global scan seed, seed `startProjectScan`/`startExternalScanning` with the user's home Claude projects dir; capture any gap as a follow-up task.

- [ ] **Step 4: Commit**

```bash
git add adapters/electron/menu.ts adapters/electron/main.ts
git commit -m "feat(electron): app menu with folder filter and layout export/import"
```

---

## Task 8: Native attention core (`attention.ts`)

Fire OS attention signals when an agent/subagent needs the user and the window is unfocused.

**Files:**
- Create: `adapters/electron/attention.ts`, `adapters/electron/attention.test.ts`
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Produces:
  - `attachAttention(deps: AttentionDeps): () => void` (returns a detach function)
  - `interface AttentionDeps { store: AgentStateStore; adapter: StateAdapter; getWindow: () => BrowserWindow | null; onCountChange?: (count: number) => void }`
- Consumes: store broadcast messages `agentToolPermission` `{id}`, `subagentToolPermission` `{id}`, `agentToolPermissionClear` `{id}`, `agentStatus` `{id, status}`; `NOTIFY_KEYS`, `NOTIFY_DEFAULTS`, `ATTENTION_DEBOUNCE_MS` from `config.ts`.

- [ ] **Step 1: Write the failing test**

Create `adapters/electron/attention.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const notificationShow = vi.fn();
const dockBounce = vi.fn();
const dockSetBadge = vi.fn();

vi.mock('electron', () => ({
  app: { dock: { bounce: dockBounce, setBadge: dockSetBadge }, focus: vi.fn() },
  shell: { beep: vi.fn() },
  Notification: class {
    static isSupported() {
      return true;
    }
    on() {}
    show = notificationShow;
    constructor(_opts: unknown) {}
  },
}));

import { AgentStateStore } from '../../server/src/agentStateStore.js';
const { attachAttention } = await import('./attention.js');

function fakeAdapter(values: Record<string, unknown> = {}) {
  return {
    getSetting: <T>(key: string, def: T): T => (key in values ? (values[key] as T) : def),
    setSetting: vi.fn(),
    loadAgents: () => [],
    saveAgents: vi.fn(),
    loadSeats: () => ({}),
    saveSeats: vi.fn(),
  };
}

describe('attachAttention', () => {
  it('fires a notification on agentToolPermission when window is unfocused', () => {
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter(),
      getWindow: () => ({ isFocused: () => false, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentToolPermission', id: 3 });
    expect(notificationShow).toHaveBeenCalledOnce();
    expect(dockBounce).toHaveBeenCalledOnce();
    expect(dockSetBadge).toHaveBeenCalledWith('1');
  });

  it('does NOT fire interrupt signals when window is focused', () => {
    notificationShow.mockClear();
    dockBounce.mockClear();
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter(),
      getWindow: () => ({ isFocused: () => true, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(notificationShow).not.toHaveBeenCalled();
    expect(dockBounce).not.toHaveBeenCalled();
  });

  it('respects the master toggle = false', () => {
    notificationShow.mockClear();
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter({ 'pixel-agents.nativeAttentionEnabled': false }),
      getWindow: () => ({ isFocused: () => false, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('clears the badge count when permission is cleared', () => {
    dockSetBadge.mockClear();
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter(),
      getWindow: () => ({ isFocused: () => false, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentToolPermission', id: 5 });
    store.broadcast({ type: 'agentToolPermissionClear', id: 5 });
    expect(dockSetBadge).toHaveBeenLastCalledWith('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd adapters/electron && npx vitest run attention.test.ts`
Expected: FAIL — cannot resolve `./attention.js`.

- [ ] **Step 3: Create `adapters/electron/attention.ts`**

```ts
import { app, Notification, shell } from 'electron';
import type { BrowserWindow } from 'electron';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { AgentStateStore } from '../../server/src/agentStateStore.js';
import { ATTENTION_DEBOUNCE_MS, NOTIFY_DEFAULTS, NOTIFY_KEYS } from './config.js';

export interface AttentionDeps {
  store: AgentStateStore;
  adapter: StateAdapter;
  getWindow: () => BrowserWindow | null;
  onCountChange?: (count: number) => void;
}

export function attachAttention(deps: AttentionDeps): () => void {
  const { store, adapter, getWindow } = deps;
  const waiting = new Set<number>();
  const lastFired = new Map<number, number>();

  const masterOn = (): boolean =>
    adapter.getSetting(NOTIFY_KEYS.master, NOTIFY_DEFAULTS.nativeAttentionEnabled);
  const sig = (key: string, def: boolean): boolean => masterOn() && adapter.getSetting(key, def);

  function updateBadge(): void {
    const count = waiting.size;
    const badgeOn = masterOn() && adapter.getSetting(NOTIFY_KEYS.dockBadge, NOTIFY_DEFAULTS.dockBadge);
    app.dock?.setBadge(badgeOn && count > 0 ? String(count) : '');
    deps.onCountChange?.(count);
  }

  function fire(id: number, reason: string): void {
    if (!masterOn()) return;
    const win = getWindow();
    if (win?.isFocused()) return; // interrupt signals only when unfocused

    const now = Date.now();
    if (now - (lastFired.get(id) ?? 0) < ATTENTION_DEBOUNCE_MS) return;
    lastFired.set(id, now);

    const wantSound = sig(NOTIFY_KEYS.osSound, NOTIFY_DEFAULTS.osSound);
    if (sig(NOTIFY_KEYS.osNotification, NOTIFY_DEFAULTS.osNotification) && Notification.isSupported()) {
      const n = new Notification({
        title: 'Pixel Agents',
        body: `Agent ${id} ${reason}`,
        silent: !wantSound,
      });
      n.on('click', () => {
        win?.show();
        win?.focus();
      });
      n.show();
    } else if (wantSound) {
      shell.beep();
    }

    if (sig(NOTIFY_KEYS.dockBounce, NOTIFY_DEFAULTS.dockBounce)) {
      app.dock?.bounce('critical');
    }
    if (sig(NOTIFY_KEYS.bringToFront, NOTIFY_DEFAULTS.bringToFront)) {
      win?.show();
      app.focus({ steal: true });
    }
  }

  function markWaiting(id: number, reason: string): void {
    waiting.add(id);
    updateBadge();
    fire(id, reason);
  }
  function clearWaiting(id: number): void {
    if (waiting.delete(id)) updateBadge();
    lastFired.delete(id);
  }

  const onBroadcast = (msg: Record<string, unknown>): void => {
    switch (msg.type) {
      case 'agentToolPermission':
        markWaiting(msg.id as number, 'needs permission');
        break;
      case 'subagentToolPermission':
        markWaiting(msg.id as number, 'subagent needs permission');
        break;
      case 'agentStatus':
        if (msg.status === 'waiting') markWaiting(msg.id as number, 'is waiting for you');
        else if (msg.status === 'active') clearWaiting(msg.id as number);
        break;
      case 'agentToolPermissionClear':
        clearWaiting(msg.id as number);
        break;
    }
  };
  const onRemoved = (id: number): void => clearWaiting(id);

  store.on('broadcast', onBroadcast);
  store.on('agentRemoved', onRemoved);

  return () => {
    store.off('broadcast', onBroadcast);
    store.off('agentRemoved', onRemoved);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd adapters/electron && npx vitest run attention.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Attach attention in `main.ts`**

In `boot()`, after the window exists and the server started:

```ts
import { attachAttention } from './attention.js';
// ...
  attachAttention({
    store: handle.store,
    adapter: handle.adapter,
    getWindow: () => win,
  });
```

- [ ] **Step 6: Manual smoke + commit**

Run: `cd ../.. && npm run dev:electron`. Move the window to the background. Run `claude` in a terminal and trigger a permission prompt (e.g. a Bash command). Expect: OS notification + dock bounce + badge "1". Focus the app → no further bounce.

```bash
git add adapters/electron/attention.ts adapters/electron/attention.test.ts adapters/electron/main.ts
git commit -m "feat(electron): native OS attention on agent waiting/permission"
```

---

## Task 9: Tray / menubar waiting-count

Show the number of waiting agents in the macOS menubar.

**Files:**
- Create: `adapters/electron/tray.ts`
- Modify: `adapters/electron/main.ts`

**Interfaces:**
- Produces: `createWaitingTray(adapter: StateAdapter): { setCount: (n: number) => void; destroy: () => void }`
- Consumes: `NOTIFY_KEYS.menubarCount`, `NOTIFY_DEFAULTS.menubarCount`; `attachAttention`'s `onCountChange`.

- [ ] **Step 1: Create `adapters/electron/tray.ts`**

```ts
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
```

- [ ] **Step 2: Wire the tray into `main.ts`**

```ts
import { createWaitingTray } from './tray.js';
// ... module-level:
let tray: { setCount: (n: number) => void; destroy: () => void } | null = null;
// ... in boot(), replace the attachAttention call:
  tray = createWaitingTray(handle.adapter);
  attachAttention({
    store: handle.store,
    adapter: handle.adapter,
    getWindow: () => win,
    onCountChange: (n) => tray?.setCount(n),
  });
// ... in before-quit:
  tray?.destroy();
  tray = null;
```

- [ ] **Step 3: Manual smoke + commit**

Run: `cd ../.. && npm run dev:electron`. Trigger a waiting agent → menubar shows `⏳1`; resolve → clears.

```bash
git add adapters/electron/tray.ts adapters/electron/main.ts
git commit -m "feat(electron): menubar waiting-count tray"
```

---

## Task 10: Settings UI — Native Alerts section

Add the configurable toggles (Electron only) to the in-app Settings modal.

**Files:**
- Modify: `core/asyncapi.yaml`, `core/src/messages.ts` (regenerated), `server/src/clientMessageHandler.ts`, `webview-ui/src/components/SettingsModal.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts`, `webview-ui/src/App.tsx`
- Test: `server/__tests__/clientMessageHandler.test.ts` (extend)

**Interfaces:**
- Produces:
  - `NotifySettings` schema (7 booleans) and `SetNotifySettings` client message (`{ type: 'setNotifySettings', notify: NotifySettings }`)
  - `settingsLoaded` gains optional `notify?: NotifySettings`
- Consumes: `NOTIFY_KEYS` semantics (mirrored as setting keys); `host` field (Task 2) to gate UI visibility.

- [ ] **Step 1: Add schemas to `core/asyncapi.yaml`**

Add a `notify` property to `SettingsLoaded.properties` (after `host`):

```yaml
        notify:
          $ref: '#/components/schemas/NotifySettings'
```

Add the `NotifySettings` schema (in `components.schemas`, near `SettingsLoaded`):

```yaml
    NotifySettings:
      description: Native attention signal toggles (Electron host only).
      type: object
      additionalProperties: false
      required:
        - nativeAttentionEnabled
        - osNotification
        - osSound
        - dockBounce
        - dockBadge
        - menubarCount
        - bringToFront
      properties:
        nativeAttentionEnabled: { type: boolean }
        osNotification: { type: boolean }
        osSound: { type: boolean }
        dockBounce: { type: boolean }
        dockBadge: { type: boolean }
        menubarCount: { type: boolean }
        bringToFront: { type: boolean }
```

Add the `SetNotifySettings` client message (mirror `SetSoundEnabled`, around line 654):

```yaml
    SetNotifySettings:
      type: object
      additionalProperties: false
      required: [type, notify]
      properties:
        type:
          const: setNotifySettings
        notify:
          $ref: '#/components/schemas/NotifySettings'
```

Register it in the `ClientMessage` `oneOf` (after `SetWatchAllSessions`, line ~130):

```yaml
        - $ref: '#/components/schemas/SetNotifySettings'
```

If the client channel (lines ~53–60) enumerates messages explicitly, mirror the `SetSoundEnabled` entry there too.

- [ ] **Step 2: Regenerate + verify**

Run: `cd .. && npm run asyncapi:generate && grep -n "SetNotifySettings\|NotifySettings" core/src/messages.ts`
Expected: both interfaces appear; `ClientMessage` union includes `SetNotifySettings`.

- [ ] **Step 3: Write the failing test (server handler)**

Append to `server/__tests__/clientMessageHandler.test.ts`:

```ts
it('persists each notify key on setNotifySettings', () => {
  const sets: Record<string, unknown> = {};
  const store = new AgentStateStore();
  store.setAdapter({
    getSetting: <T>(_k: string, d: T) => d,
    setSetting: <T>(k: string, v: T) => {
      sets[k] = v;
    },
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
  });
  handleClientMessage(
    {
      type: 'setNotifySettings',
      notify: {
        nativeAttentionEnabled: true,
        osNotification: false,
        osSound: true,
        dockBounce: true,
        dockBadge: false,
        menubarCount: true,
        bringToFront: true,
      },
    },
    () => {},
    { store, runtime: undefined, cache: null, host: 'electron' },
  );
  expect(sets['pixel-agents.notify.osNotification']).toBe(false);
  expect(sets['pixel-agents.nativeAttentionEnabled']).toBe(true);
  expect(sets['pixel-agents.notify.bringToFront']).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts`
Expected: FAIL — keys not persisted (case not handled).

- [ ] **Step 5: Handle `setNotifySettings` + include `notify` in `settingsLoaded`**

In `server/src/clientMessageHandler.ts`, add the setting key constants near the others:

```ts
const NOTIFY_SETTING_KEYS: Record<string, string> = {
  nativeAttentionEnabled: 'pixel-agents.nativeAttentionEnabled',
  osNotification: 'pixel-agents.notify.osNotification',
  osSound: 'pixel-agents.notify.osSound',
  dockBounce: 'pixel-agents.notify.dockBounce',
  dockBadge: 'pixel-agents.notify.dockBadge',
  menubarCount: 'pixel-agents.notify.menubarCount',
  bringToFront: 'pixel-agents.notify.bringToFront',
};

const NOTIFY_DEFAULTS: Record<string, boolean> = {
  nativeAttentionEnabled: true,
  osNotification: true,
  osSound: true,
  dockBounce: true,
  dockBadge: true,
  menubarCount: true,
  bringToFront: false,
};
```

Add the case in the switch:

```ts
    case 'setNotifySettings': {
      const notify = (msg.notify ?? {}) as Record<string, boolean>;
      for (const [field, key] of Object.entries(NOTIFY_SETTING_KEYS)) {
        if (field in notify) adapter?.setSetting(key, notify[field]);
      }
      break;
    }
```

In `handleWebviewReady`, build and include `notify`:

```ts
  const notify: Record<string, boolean> = {};
  for (const [field, key] of Object.entries(NOTIFY_SETTING_KEYS)) {
    notify[field] = adapter?.getSetting(key, NOTIFY_DEFAULTS[field]) ?? NOTIFY_DEFAULTS[field];
  }
```

and add `notify,` to the `settingsLoaded` payload object.

- [ ] **Step 6: Run server test to verify pass**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts`
Expected: PASS.

- [ ] **Step 7: Thread `host`/`notify` through the webview state**

In `webview-ui/src/hooks/useExtensionMessages.ts`, add to the message state interface:

```ts
  host: string;
  notify: Record<string, boolean>;
```

Initialize them (`host: 'browser'`, `notify: {}`) in the state initializer, and in the `settingsLoaded` case set:

```ts
        host: (msg.host as string) ?? 'browser',
        notify: (msg.notify as Record<string, boolean>) ?? {},
```

Expose `host` and `notify` from the hook's return value (add to the returned object alongside the other settings fields).

- [ ] **Step 8: Add the Native Alerts section to `SettingsModal.tsx`**

Add props to `SettingsModalProps`:

```ts
  host: string;
  notify: Record<string, boolean>;
```

Destructure `host`, `notify` in the component signature. Add this block before the closing `</Modal>` (after the Debug View checkbox):

```tsx
      {host === 'electron' && (
        <>
          <div className="px-10 pt-8 pb-2 text-xs text-text-muted">Native Alerts</div>
          {(
            [
              ['nativeAttentionEnabled', 'Enable Native Alerts'],
              ['osNotification', 'OS Notification'],
              ['osSound', 'OS Sound'],
              ['dockBounce', 'Dock Bounce'],
              ['dockBadge', 'Dock Badge Count'],
              ['menubarCount', 'Menubar Count'],
              ['bringToFront', 'Bring Window To Front'],
            ] as const
          ).map(([key, label]) => (
            <Checkbox
              key={key}
              label={label}
              checked={notify[key] ?? key !== 'bringToFront'}
              onChange={() => {
                const next = { ...notify, [key]: !(notify[key] ?? key !== 'bringToFront') };
                transport.send({ type: 'setNotifySettings', notify: next });
              }}
            />
          ))}
        </>
      )}
```

NOTE: `notify[key] ?? key !== 'bringToFront'` mirrors the defaults (everything ON except `bringToFront`). The local `notify` prop won't update live after a toggle unless `App.tsx` re-renders from a fresh `settingsLoaded`; for MVP the toggle persists server-side and the checkbox reflects the optimistic computed value on next open. If you want live reflection, lift `notify` into local state seeded from the prop.

- [ ] **Step 9: Pass `host`/`notify` from `App.tsx`**

In `webview-ui/src/App.tsx`, find where `<SettingsModal ... />` is rendered and add `host={host} notify={notify}` using the values now returned from `useExtensionMessages`.

- [ ] **Step 10: Type-check, lint, build, manual smoke**

Run: `cd .. && npm run check-types && npm run lint && npm run build`
Then `npm run dev:electron`: open Settings → "Native Alerts" section is visible (Electron). Toggle off "Dock Bounce" → trigger a waiting agent unfocused → no bounce (notification still appears).
Also run `npx pixel-agents` and open `http://127.0.0.1:3100` in a browser → "Native Alerts" section is HIDDEN (host = standalone).

- [ ] **Step 11: Commit**

```bash
git add core/asyncapi.yaml core/src/messages.ts server/src/clientMessageHandler.ts server/__tests__/clientMessageHandler.test.ts webview-ui/src/components/SettingsModal.tsx webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/App.tsx
git commit -m "feat: native alerts settings section (electron only)"
```

---

## Task 11: Packaging (electron-builder, macOS)

Produce a runnable `.app`/`.dmg`.

**Files:**
- Modify: root `package.json` (electron-builder config), `esbuild.js` (ensure production layout)

**Interfaces:**
- Consumes: `dist/` (built by `npm run compile`), `dist/electron-main.js` (Task 3).

- [ ] **Step 1: Add electron-builder config to root `package.json`**

Add a top-level `"build"` key:

```json
  "build": {
    "appId": "tech.naowee.pixelagents",
    "productName": "Pixel Agents",
    "files": [
      "dist/**/*",
      "node_modules/fastify/**/*",
      "node_modules/@fastify/**/*"
    ],
    "extraMetadata": { "main": "dist/electron-main.js" },
    "directories": { "output": "release" },
    "mac": {
      "target": ["dmg", "zip"],
      "category": "public.app-category.developer-tools"
    }
  }
```

NOTE: `extraMetadata.main` points electron-builder at the bundled main. Ensure root `package.json` `main` does NOT break the VS Code extension build — keep the existing `"main": "./dist/extension.js"` for VS Code; `extraMetadata.main` overrides only inside the packaged app.

- [ ] **Step 2: Add `electron` + `electron-builder` as root devDependencies**

Run: `npm install -D electron@^33.0.0 electron-builder@^25.0.0`

- [ ] **Step 3: Build the app**

Run: `npm run build:electron`
Expected: `release/` contains `Pixel Agents-<version>.dmg` and a `.app` under `release/mac*/`.

- [ ] **Step 4: Launch the packaged app**

Run: `open "release/mac-arm64/Pixel Agents.app"` (path varies by arch).
Expected: app launches, shows the office, boots its own server (check Activity Monitor / `lsof -i` for a 127.0.0.1 listener), attention signals work. Verify single-instance: launching again just focuses the window.

NOTE: unsigned app — macOS Gatekeeper may require right-click → Open the first time. Signing/notarization is a later etapa.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json esbuild.js
git commit -m "build(electron): electron-builder macOS packaging"
```

---

## Task 12: E2E smoke (Playwright + Electron)

Automated launch test.

**Files:**
- Create: `e2e/tests/electron-app.spec.ts`
- Modify: `package.json` (e2e:electron script if needed)

**Interfaces:**
- Consumes: built `dist/electron-main.js`; Playwright's `_electron` API (Playwright already a devDependency).

- [ ] **Step 1: Write the E2E test**

Create `e2e/tests/electron-app.spec.ts`:

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test('electron app launches and renders the office canvas', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'dist', 'electron-main.js')],
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // The office renders into a <canvas>.
  await expect(window.locator('canvas')).toBeVisible({ timeout: 15000 });
  await app.close();
});
```

- [ ] **Step 2: Ensure the bundle exists, then run**

Run: `npm run compile && npx playwright test e2e/tests/electron-app.spec.ts`
Expected: PASS — window opens and a `canvas` is visible.

NOTE: if Playwright's default config scopes only VS Code e2e, add an `e2e:electron` script: `"e2e:electron": "playwright test e2e/tests/electron-app.spec.ts"`. The electron launch does not need the VS Code harness.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/electron-app.spec.ts package.json
git commit -m "test(electron): playwright launch smoke test"
```

---

## Self-Review

**Spec coverage:**
- §2/§4 Electron in-process wrapper + window → Tasks 3, 4.
- §3 bootstrap refactor → Task 1.
- §5 native bridge (export/import/asset-dir/open-folder) → Tasks 2 + 6.
- §6 global + folder filter → Task 7.
- §7 hooks first-run → folded into Task 1 (`startStandaloneServer` installs hooks, same as cli.ts).
- §8 packaging → Task 11.
- §9 error handling → boot failure quits (Task 3); WS reconnect is pre-existing; bind auto-assign (Task 1). Permission-write failures surface via existing server logging (acceptable for MVP; no dedicated task).
- §10 testing → unit tests in Tasks 1,2,6,8,10; E2E in Task 12.
- §12 native attention + settings → Tasks 8, 9, 10.
- §6 single instance/lifecycle → Task 5.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" left. NOTE blocks flag real verification points (assetLoader signature, global-scan behavior, live checkbox reflection) rather than hiding missing code.

**Type consistency:** `startStandaloneServer`/`stopStandalone`/`StandaloneHandle` consistent across Tasks 1,3,6,7,8. `HostCallbacks` field names (`onExportLayout`/`onImportLayout`/`onPickAssetDir`/`onOpenPath`) consistent across Tasks 2 and 6. `NOTIFY_KEYS` (config.ts) and the server's `NOTIFY_SETTING_KEYS` use identical setting-key strings (`pixel-agents.notify.*` + `pixel-agents.nativeAttentionEnabled`). `attachAttention` signature consistent across Tasks 8 and 9. `setNotifySettings` message shape (`{type, notify}`) consistent across asyncapi (Task 10), server handler (Task 10), and UI (Task 10).
</content>
</invoke>
