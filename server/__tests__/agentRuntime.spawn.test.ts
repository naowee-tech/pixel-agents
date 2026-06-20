import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/index.js';

describe('AgentRuntime.registerSpawnedAgent', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-spawn-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates an app-spawned agent with hasTerminal and pre-registers its jsonl', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    const created: number[] = [];
    store.on('agentAdded', (id) => created.push(id));

    const id = runtime.registerSpawnedAgent({ sessionId: 'sess-abc', projectDir: dir });

    const agent = store.get(id);
    expect(agent).toBeDefined();
    expect(agent!.isExternal).toBe(false);
    expect(agent!.hasTerminal).toBe(true);
    expect(agent!.sessionId).toBe('sess-abc');
    expect(agent!.jsonlFile).toBe(path.join(dir, 'sess-abc.jsonl'));
    expect(runtime.knownJsonlFiles.has(path.join(dir, 'sess-abc.jsonl'))).toBe(true);
    expect(created).toContain(id);
    runtime.dispose();
  });

  it('markTerminalDetached clears hasTerminal', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    const id = runtime.registerSpawnedAgent({ sessionId: 'sess-xyz', projectDir: dir });
    runtime.markTerminalDetached(id);
    expect(store.get(id)!.hasTerminal).toBeFalsy();
    runtime.dispose();
  });
});
