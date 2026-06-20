import { describe, expect, it, vi } from 'vitest';

import { createTerminalBridge } from './terminalBridge.js';

function fakeManager() {
  let dataCb: ((id: number, d: string) => void) | null = null;
  let exitCb: ((id: number, c: number) => void) | null = null;
  return {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
    onData: (cb: (id: number, d: string) => void) => {
      dataCb = cb;
    },
    onExit: (cb: (id: number, c: number) => void) => {
      exitCb = cb;
    },
    emitData: (id: number, d: string) => dataCb?.(id, d),
    emitExit: (id: number, c: number) => exitCb?.(id, c),
  };
}

describe('terminalBridge', () => {
  it('spawn/input/resize/kill forward to the manager', () => {
    const manager = fakeManager();
    const bridge = createTerminalBridge({ manager, broadcast: vi.fn() });
    bridge.onSpawnTerminal!({ id: 1, cwd: '/tmp', command: 'claude' });
    expect(manager.spawn).toHaveBeenCalledWith({ id: 1, cwd: '/tmp', command: 'claude' });
    bridge.onTerminalInput!({ id: 1, data: 'x' });
    expect(manager.write).toHaveBeenCalledWith(1, 'x');
    bridge.onTerminalResize!({ id: 1, cols: 90, rows: 20 });
    expect(manager.resize).toHaveBeenCalledWith(1, 90, 20);
    bridge.onKillTerminal!(1);
    expect(manager.kill).toHaveBeenCalledWith(1);
  });

  it('relays pty data as terminalData and exit as agentTerminalDetached', () => {
    const manager = fakeManager();
    const broadcast = vi.fn();
    const onExit = vi.fn();
    createTerminalBridge({ manager, broadcast, onExit });
    manager.emitData(3, 'out');
    expect(broadcast).toHaveBeenCalledWith({ type: 'terminalData', id: 3, data: 'out' });
    manager.emitExit(3, 0);
    expect(onExit).toHaveBeenCalledWith(3);
    expect(broadcast).toHaveBeenCalledWith({ type: 'agentTerminalDetached', id: 3 });
  });
});
