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
