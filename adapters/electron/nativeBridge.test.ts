import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => fsWrite.mockClear());

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
