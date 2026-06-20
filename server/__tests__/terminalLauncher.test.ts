import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/index.js';
import { adoptTerminalAgent, launchTerminalAgent } from '../src/terminalLauncher.js';

describe('terminalLauncher', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-launch-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('launchTerminalAgent spawns a fresh agent and requests a pty', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    const onSpawnTerminal = vi.fn();
    const attached: number[] = [];
    store.on('broadcast', (m) => {
      if (m.type === 'agentTerminalAttached') attached.push(m.id as number);
    });

    launchTerminalAgent({ runtime, store, onSpawnTerminal }, { folderPath: dir });

    expect(onSpawnTerminal).toHaveBeenCalledOnce();
    const arg = onSpawnTerminal.mock.calls[0][0];
    expect(typeof arg.id).toBe('number');
    expect(arg.cwd).toBe(dir);
    expect(arg.command).toMatch(/^claude --session-id /);
    expect(store.get(arg.id)!.hasTerminal).toBe(true);
    expect(attached).toContain(arg.id);
    runtime.dispose();
  });

  it('adoptTerminalAgent attaches a resume pty to an existing agent', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    // Seed an external agent.
    const id = runtime.registerSpawnedAgent({ sessionId: 'sess-ext', projectDir: dir });
    runtime.markTerminalDetached(id);
    const onSpawnTerminal = vi.fn();

    adoptTerminalAgent({ runtime, store, onSpawnTerminal }, { id });

    expect(onSpawnTerminal).toHaveBeenCalledOnce();
    const arg = onSpawnTerminal.mock.calls[0][0];
    expect(arg.id).toBe(id);
    expect(arg.command).toBe('claude --resume sess-ext');
    expect(store.get(id)!.hasTerminal).toBe(true);
    runtime.dispose();
  });

  it('adoptTerminalAgent is a no-op for an unknown id', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    const onSpawnTerminal = vi.fn();
    adoptTerminalAgent({ runtime, store, onSpawnTerminal }, { id: 999 });
    expect(onSpawnTerminal).not.toHaveBeenCalled();
    runtime.dispose();
  });
});
