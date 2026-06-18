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

const { sanitizeBounds, createMainWindow } = await import('./window.js');
const { WINDOW_STATE_KEY } = await import('./config.js');

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

describe('createMainWindow', () => {
  it('persists window bounds on close', () => {
    const setSetting = vi.fn();
    const win = createMainWindow({
      url: 'http://127.0.0.1:9999',
      getSetting: <T>(_key: string, def: T): T => def,
      setSetting,
    }) as unknown as { handlers: Record<string, () => void> };

    // The FakeWindow records 'on' handlers; grab the captured close handler.
    const closeHandler = win.handlers['close'];
    expect(closeHandler).toBeTypeOf('function');
    closeHandler();

    expect(setSetting).toHaveBeenCalledWith(WINDOW_STATE_KEY, {
      width: 800,
      height: 600,
      x: 10,
      y: 20,
    });
  });
});
