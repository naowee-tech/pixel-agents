import { describe, expect, it, vi } from 'vitest';

const notificationShow = vi.fn();
const dockBounce = vi.fn(() => 42);
const dockCancelBounce = vi.fn();
const dockSetBadge = vi.fn();

vi.mock('electron', () => ({
  app: {
    dock: { bounce: dockBounce, cancelBounce: dockCancelBounce, setBadge: dockSetBadge },
    focus: vi.fn(),
  },
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

  it('marks an agent on agentStatus waiting and clears it on active', () => {
    notificationShow.mockClear();
    dockBounce.mockClear();
    dockSetBadge.mockClear();
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter(),
      getWindow: () => ({ isFocused: () => false, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentStatus', id: 7, status: 'waiting' });
    expect(notificationShow).toHaveBeenCalledOnce();
    expect(dockBounce).toHaveBeenCalledOnce();
    expect(dockSetBadge).toHaveBeenLastCalledWith('1');

    store.broadcast({ type: 'agentStatus', id: 7, status: 'active' });
    expect(dockSetBadge).toHaveBeenLastCalledWith('');
  });

  it('cancels the dock bounce when the wait is resolved', () => {
    dockBounce.mockClear();
    dockCancelBounce.mockClear();
    const store = new AgentStateStore();
    attachAttention({
      store,
      adapter: fakeAdapter(),
      getWindow: () => ({ isFocused: () => false, show: vi.fn(), focus: vi.fn() }) as never,
    });
    store.broadcast({ type: 'agentToolPermission', id: 9 });
    expect(dockBounce).toHaveBeenCalledOnce();
    store.broadcast({ type: 'agentToolPermissionClear', id: 9 });
    expect(dockCancelBounce).toHaveBeenCalledWith(42);
  });
});
