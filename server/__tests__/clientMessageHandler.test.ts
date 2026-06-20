import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { claudeProvider } from '../src/providers/index.js';

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
});

describe('terminal messages', () => {
  function ctxWith(overrides: Record<string, unknown> = {}) {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    return {
      store,
      runtime,
      base: { store, runtime, cache: null, host: 'electron', ...overrides },
    };
  }

  it('routes terminalInput to onTerminalInput', async () => {
    const onTerminalInput = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onTerminalInput } });
    await handleClientMessage({ type: 'terminalInput', id: 5, data: 'ls\r' }, vi.fn(), base);
    expect(onTerminalInput).toHaveBeenCalledWith({ id: 5, data: 'ls\r' });
  });

  it('routes terminalResize to onTerminalResize', async () => {
    const onTerminalResize = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onTerminalResize } });
    await handleClientMessage(
      { type: 'terminalResize', id: 5, cols: 100, rows: 30 },
      vi.fn(),
      base,
    );
    expect(onTerminalResize).toHaveBeenCalledWith({ id: 5, cols: 100, rows: 30 });
  });

  it('launchAgent spawns via onSpawnTerminal', async () => {
    const onSpawnTerminal = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onSpawnTerminal } });
    await handleClientMessage({ type: 'launchAgent' }, vi.fn(), base);
    expect(onSpawnTerminal).toHaveBeenCalledOnce();
  });

  it('webviewReady includes terminalAgents for spawned agents', async () => {
    const { store, runtime, base } = ctxWith();
    runtime.registerSpawnedAgent({ sessionId: 's1', projectDir: '/tmp' });
    const sent: Record<string, unknown>[] = [];
    await handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), base);
    const existing = sent.find((m) => m.type === 'existingAgents');
    expect(existing).toBeDefined();
    expect(Object.values(existing!.terminalAgents as Record<number, boolean>)).toContain(true);
    void store;
    runtime.dispose();
  });
});
