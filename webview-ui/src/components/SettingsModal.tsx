import { useEffect, useState } from 'react';

import type { NotifySettings } from '../../../core/src/messages.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  externalAssetDirectories: string[];
  watchAllSessions: boolean;
  onToggleWatchAllSessions: () => void;
  hooksEnabled: boolean;
  onToggleHooksEnabled: () => void;
  host: string;
  notify: Partial<NotifySettings>;
}

type NotifyKey = keyof NotifySettings;

// Native Alerts toggles (Electron host only). Default ON for everything except
// bringToFront — mirror the server-side NOTIFY_DEFAULTS.
const NOTIFY_ROWS: readonly (readonly [NotifyKey, string])[] = [
  ['nativeAttentionEnabled', 'Enable Native Alerts'],
  ['osNotification', 'OS Notification'],
  ['osSound', 'OS Sound'],
  ['dockBounce', 'Dock Bounce'],
  ['dockBadge', 'Dock Badge Count'],
  ['menubarCount', 'Menubar Count'],
  ['bringToFront', 'Bring Window To Front'],
];

function notifyDefault(key: NotifyKey): boolean {
  return key !== 'bringToFront';
}

export function SettingsModal({
  isOpen,
  onClose,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  externalAssetDirectories,
  watchAllSessions,
  onToggleWatchAllSessions,
  hooksEnabled,
  onToggleHooksEnabled,
  host,
  notify,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);

  // Lift notify into local state so the checkboxes reflect toggles immediately,
  // without waiting for a fresh settingsLoaded round-trip. Re-seed from the prop
  // whenever the server pushes new values.
  const [notifyLocal, setNotifyLocal] = useState<Partial<NotifySettings>>(notify);
  useEffect(() => {
    setNotifyLocal(notify);
  }, [notify]);

  const handleNotifyToggle = (key: NotifyKey) => {
    // Build a complete NotifySettings (all 7 keys) resolving each from local state
    // or its default, then flip the toggled key. transport.send requires the full shape.
    const current = (k: NotifyKey) => notifyLocal[k] ?? notifyDefault(k);
    const resolve = (k: NotifyKey) => (k === key ? !current(k) : current(k));
    const next: NotifySettings = {
      nativeAttentionEnabled: resolve('nativeAttentionEnabled'),
      osNotification: resolve('osNotification'),
      osSound: resolve('osSound'),
      dockBounce: resolve('dockBounce'),
      dockBadge: resolve('dockBadge'),
      menubarCount: resolve('menubarCount'),
      bringToFront: resolve('bringToFront'),
    };
    setNotifyLocal(next);
    transport.send({ type: 'setNotifySettings', notify: next });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <MenuItem
        onClick={() => {
          transport.send({ type: 'openSessionsFolder' });
          onClose();
        }}
      >
        Open Sessions Folder
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'exportLayout' });
          onClose();
        }}
      >
        Export Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'importLayout' });
          onClose();
        }}
      >
        Import Layout
      </MenuItem>
      <MenuItem
        onClick={() => {
          transport.send({ type: 'addExternalAssetDirectory' });
          onClose();
        }}
      >
        Add Asset Directory
      </MenuItem>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
      <Checkbox
        label="Sound Notifications"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      <Checkbox
        label="Watch All Sessions"
        checked={watchAllSessions}
        onChange={onToggleWatchAllSessions}
      />
      <Checkbox
        label="Instant Detection (Hooks)"
        checked={hooksEnabled}
        onChange={onToggleHooksEnabled}
      />
      <Checkbox
        label="Always Show Labels"
        checked={alwaysShowOverlay}
        onChange={onToggleAlwaysShowOverlay}
      />
      <Checkbox label="Debug View" checked={isDebugMode} onChange={onToggleDebugMode} />
      {host === 'electron' && (
        <>
          <div className="px-10 pt-8 pb-2 text-xs text-text-muted">Native Alerts</div>
          {NOTIFY_ROWS.map(([key, label]) => (
            <Checkbox
              key={key}
              label={label}
              checked={notifyLocal[key] ?? notifyDefault(key)}
              onChange={() => handleNotifyToggle(key)}
            />
          ))}
        </>
      )}
    </Modal>
  );
}
