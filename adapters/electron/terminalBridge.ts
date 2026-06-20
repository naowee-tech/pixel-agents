import type { HostCallbacks } from '../../server/src/clientMessageHandler.js';
import type { TerminalManager } from './terminalManager.js';

export interface TerminalBridgeDeps {
  manager: TerminalManager;
  /** store.broadcast — push a ServerMessage to all connected webview clients. */
  broadcast: (message: Record<string, unknown>) => void;
  /** Called when a pty exits (clear the agent's hasTerminal flag). */
  onExit?: (id: number) => void;
}

type TerminalCallbacks = Pick<
  HostCallbacks,
  'onSpawnTerminal' | 'onTerminalInput' | 'onTerminalResize' | 'onKillTerminal'
>;

export function createTerminalBridge(deps: TerminalBridgeDeps): TerminalCallbacks {
  const { manager, broadcast } = deps;

  manager.onData((id, data) => broadcast({ type: 'terminalData', id, data }));
  manager.onExit((id) => {
    deps.onExit?.(id);
    broadcast({ type: 'agentTerminalDetached', id });
  });

  return {
    onSpawnTerminal: (opts) => manager.spawn(opts),
    onTerminalInput: ({ id, data }) => manager.write(id, data),
    onTerminalResize: ({ id, cols, rows }) => manager.resize(id, cols, rows),
    onKillTerminal: (id) => manager.kill(id),
  };
}
