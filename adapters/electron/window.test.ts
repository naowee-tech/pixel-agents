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
