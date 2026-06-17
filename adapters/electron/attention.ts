import type { BrowserWindow } from 'electron';
import { app, Notification, shell } from 'electron';

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
    const badgeOn =
      masterOn() && adapter.getSetting(NOTIFY_KEYS.dockBadge, NOTIFY_DEFAULTS.dockBadge);
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
    if (
      sig(NOTIFY_KEYS.osNotification, NOTIFY_DEFAULTS.osNotification) &&
      Notification.isSupported()
    ) {
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
