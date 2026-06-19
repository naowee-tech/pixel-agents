# Electron Embedded Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Claude agents in real embedded terminals inside the Electron app (node-pty in main + xterm.js in the webview), with a resizable 3-panel shell (tabs · office · terminal).

**Architecture:** The server (in-process in Electron main) stays the owner of agent state; it orchestrates spawning (sessionId, command, AgentState, JSONL watching) and asks the host (Electron) to run a pty via host callbacks — the same `nativeBridge` pattern phase 1 established. Electron owns the `node-pty` processes, keyed by agent id. Terminal I/O is multiplexed over the existing `/ws` WebSocket (no IPC, no preload). The webview gains an Electron-only shell wrapping the existing office canvas.

**Tech Stack:** TypeScript, Node, Electron 33, Fastify WS, React 19, `node-pty`, `@xterm/xterm` + `@xterm/addon-fit`, `react-resizable-panels`, AsyncAPI codegen, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-electron-embedded-terminal-design.md`

## Global Constraints

- Repo root for all paths: `/Users/jpahcecou/Developer/native-pixelagents/repo`. Branch: `feat/electron-native-app`.
- TypeScript: no `enum` (`erasableSyntaxOnly`) — use `as const`. `import type` for type-only imports (`verbatimModuleSyntax`). `noUnusedLocals` / `noUnusedParameters`.
- Message contract is **auto-generated**: `core/src/messages.ts` is generated from `core/asyncapi.yaml` by `npm run asyncapi:generate`. NEVER hand-edit `core/src/messages.ts`. `transport.send()` is typed to `ClientMessage`, so every new client message MUST be added to the yaml and regenerated.
- All client/server message variants use the field name `id` (integer agent id), matching every existing message.
- Terminal I/O travels over the existing `/ws` only. No Electron IPC, no preload script.
- `node-pty` is a **native module**: esbuild must externalize it; electron-builder must `asarUnpack` it and rebuild it for Electron's ABI.
- macOS first. Do not add Windows packaging.
- gitleaks is installed — commit normally (no `--no-verify`).
- Per-package test commands: server → `cd server && npx vitest run __tests__/<file>`; electron adapter → `cd adapters/electron && npx vitest run <file>`. Type/build gate → `npm run check-types` (root) and `npm run build:webview`.

## File Structure

**Contract**

- `core/asyncapi.yaml` (modify) — add terminal message schemas + union entries; extend `ExistingAgents`.
- `core/src/messages.ts` (regenerated) — do not hand-edit.

**Server (agent orchestration)**

- `server/src/types.ts` (modify) — `AgentState.hasTerminal?: boolean`.
- `server/src/providers/hook/claude/claude.ts` (modify) — `buildLaunchCommand` gains `{ resume?: boolean }`.
- `server/src/agentRuntime.ts` (modify) — `registerSpawnedAgent()`, `markTerminalDetached()`.
- `server/src/terminalLauncher.ts` (create) — `launchTerminalAgent()`, `adoptTerminalAgent()`, `decodeProjectDirToCwd()`.
- `server/src/clientMessageHandler.ts` (modify) — extend `HostCallbacks`; handle `launchAgent`/`adoptAgent`/`terminalInput`/`terminalResize`/`closeAgent`; add `terminalAgents` to `existingAgents`.

**Electron (pty host)**

- `adapters/electron/terminalManager.ts` (create) — node-pty wrapper keyed by agent id.
- `adapters/electron/terminalBridge.ts` (create) — host callbacks + data/exit relay.
- `adapters/electron/main.ts` (modify) — build manager+bridge, merge into hostCallbacks, kill ptys on quit.
- `adapters/electron/package.json` (modify) — `node-pty` dep.
- `esbuild.js` (modify) — externalize `node-pty` in the electron-main bundle.
- `package.json` (root, modify) — `node-pty` dependency; electron-builder `asarUnpack`.

**Webview (UI)**

- `webview-ui/package.json` (modify) — `@xterm/xterm`, `@xterm/addon-fit`, `react-resizable-panels`.
- `webview-ui/src/terminal/terminalClient.ts` (create) — xterm instances keyed by agent id.
- `webview-ui/src/components/AgentTabs.tsx` (create).
- `webview-ui/src/components/TerminalPanel.tsx` (create).
- `webview-ui/src/components/ElectronShell.tsx` (create) — resizable 3-panel layout.
- `webview-ui/src/hooks/useExtensionMessages.ts` (modify) — terminal state + message routing.
- `webview-ui/src/App.tsx` (modify) — focusedAgentId, extract office view, render shell when `host==='electron'`.
- `webview-ui/src/components/BottomToolbar.tsx` (modify) — gate `+ Agent` by host, electron launch path.
- `webview-ui/src/index.css` (modify) — import xterm CSS.

**E2E**

- `e2e/tests/electron-terminal.spec.ts` (create) — shell-renders smoke.

---

### Task 1: Message contract (AsyncAPI + regen)

**Files:**

- Modify: `core/asyncapi.yaml`
- Regenerated (do not edit): `core/src/messages.ts`

**Interfaces:**

- Produces (client→server): `AdoptAgent {type:'adoptAgent', id:number}`, `TerminalInput {type:'terminalInput', id:number, data:string}`, `TerminalResize {type:'terminalResize', id:number, cols:number, rows:number}`.
- Produces (server→client): `TerminalData {type:'terminalData', id:number, data:string}`, `TerminalError {type:'terminalError', id:number, message:string}`, `AgentTerminalAttached {type:'agentTerminalAttached', id:number}`, `AgentTerminalDetached {type:'agentTerminalDetached', id:number}`.
- Produces: `ExistingAgents` gains required `terminalAgents: Record<string, boolean>`.

- [ ] **Step 1: Add the four new server schemas.** In `core/asyncapi.yaml`, under `components.schemas`, immediately after the `AgentSelected` schema (ends at the `agentSelected` `id: integer` block, ~line 199), insert:

```yaml
TerminalData:
  description: A chunk of pty output for an agent's embedded terminal (Electron).
  type: object
  additionalProperties: false
  required: [type, id, data]
  properties:
    type:
      const: terminalData
    id:
      type: integer
    data:
      type: string

TerminalError:
  description: An embedded terminal failed to spawn or errored (Electron).
  type: object
  additionalProperties: false
  required: [type, id, message]
  properties:
    type:
      const: terminalError
    id:
      type: integer
    message:
      type: string

AgentTerminalAttached:
  description: The agent now has a live in-app terminal (pty spawned/adopted).
  type: object
  additionalProperties: false
  required: [type, id]
  properties:
    type:
      const: agentTerminalAttached
    id:
      type: integer

AgentTerminalDetached:
  description: The agent's in-app terminal died (pty exited); it is read-only again.
  type: object
  additionalProperties: false
  required: [type, id]
  properties:
    type:
      const: agentTerminalDetached
    id:
      type: integer
```

- [ ] **Step 2: Add the three new client schemas.** In `core/asyncapi.yaml`, after the `CloseAgent` schema (~line 653), insert:

```yaml
AdoptAgent:
  description: Attach an in-app terminal to an existing (external/detached) agent via claude --resume.
  type: object
  additionalProperties: false
  required: [type, id]
  properties:
    type:
      const: adoptAgent
    id:
      type: integer

TerminalInput:
  description: Keyboard/paste input from xterm to the agent's pty.
  type: object
  additionalProperties: false
  required: [type, id, data]
  properties:
    type:
      const: terminalInput
    id:
      type: integer
    data:
      type: string

TerminalResize:
  description: xterm viewport resized; resize the agent's pty.
  type: object
  additionalProperties: false
  required: [type, id, cols, rows]
  properties:
    type:
      const: terminalResize
    id:
      type: integer
    cols:
      type: integer
    rows:
      type: integer
```

- [ ] **Step 3: Register the schemas in the unions and extend ExistingAgents.** In `core/asyncapi.yaml`:

In `ServerMessage.oneOf` (after the `- $ref: '#/components/schemas/AgentSelected'` line, ~line 85) add:

```yaml
- $ref: '#/components/schemas/TerminalData'
- $ref: '#/components/schemas/TerminalError'
- $ref: '#/components/schemas/AgentTerminalAttached'
- $ref: '#/components/schemas/AgentTerminalDetached'
```

In `ClientMessage.oneOf` (after the `- $ref: '#/components/schemas/CloseAgent'` line, ~line 122) add:

```yaml
- $ref: '#/components/schemas/AdoptAgent'
- $ref: '#/components/schemas/TerminalInput'
- $ref: '#/components/schemas/TerminalResize'
```

In the `ExistingAgents` schema: add `terminalAgents` to `required` (becomes `required: [type, agents, agentMeta, folderNames, externalAgents, terminalAgents]`) and add this property after the `externalAgents` property block:

```yaml
terminalAgents:
  type: object
  description: Map of agent ID (string) to "has live in-app terminal" flag.
  additionalProperties:
    type: boolean
```

- [ ] **Step 4: Regenerate and type-check.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run asyncapi:generate && npm run check-types`
Expected: PASS. `git diff core/src/messages.ts` shows new exported interfaces `TerminalData`, `TerminalError`, `AgentTerminalAttached`, `AgentTerminalDetached`, `AdoptAgent`, `TerminalInput`, `TerminalResize`, the union additions, and `terminalAgents` on `ExistingAgents`.

- [ ] **Step 5: Commit.**

```bash
git add core/asyncapi.yaml core/src/messages.ts
git commit -m "feat(core): terminal message contract for embedded Electron terminal"
```

---

### Task 2: claude --resume launch command

**Files:**

- Modify: `server/src/providers/hook/claude/claude.ts:96-104`
- Test: `server/__tests__/claude.test.ts`

**Interfaces:**

- Produces: `buildLaunchCommand(sessionId: string, cwd: string, opts?: { bypassPermissions?: boolean; resume?: boolean }): { command: string; args: string[]; env?: Record<string,string> }`. When `resume` is true, args are `['--resume', sessionId]` instead of `['--session-id', sessionId]`.

- [ ] **Step 1: Write the failing test.** Append to `server/__tests__/claude.test.ts` (inside the existing top-level `describe`, or add a new `describe('buildLaunchCommand resume')` — match the file's existing import of `claudeProvider`):

```ts
describe('buildLaunchCommand resume', () => {
  it('uses --session-id for a fresh launch', () => {
    const r = claudeProvider.buildLaunchCommand!('sess-1', '/tmp/x');
    expect(r.args).toEqual(['--session-id', 'sess-1']);
  });

  it('uses --resume when resume:true', () => {
    const r = claudeProvider.buildLaunchCommand!('sess-1', '/tmp/x', { resume: true });
    expect(r.args).toEqual(['--resume', 'sess-1']);
  });

  it('keeps bypass flag with resume', () => {
    const r = claudeProvider.buildLaunchCommand!('sess-1', '/tmp/x', {
      resume: true,
      bypassPermissions: true,
    });
    expect(r.args).toEqual(['--resume', 'sess-1', '--dangerously-skip-permissions']);
  });
});
```

(If `claude.test.ts` does not already import `claudeProvider`, add `import { claudeProvider } from '../src/providers/index.js';` and `import { describe, it, expect } from 'vitest';` at the top following the file's existing style.)

- [ ] **Step 2: Run the test, verify it fails.**

Run: `cd server && npx vitest run __tests__/claude.test.ts -t "buildLaunchCommand resume"`
Expected: FAIL — third case errors / `--resume` not produced.

- [ ] **Step 3: Implement.** Replace `server/src/providers/hook/claude/claude.ts:96-104` with:

```ts
function buildLaunchCommand(
  sessionId: string,
  cwd: string,
  opts?: { bypassPermissions?: boolean; resume?: boolean },
): { command: string; args: string[]; env?: Record<string, string> } {
  const args = opts?.resume ? ['--resume', sessionId] : ['--session-id', sessionId];
  if (opts?.bypassPermissions) args.push('--dangerously-skip-permissions');
  return { command: 'claude', args, env: { PWD: cwd } };
}
```

- [ ] **Step 4: Run the test, verify it passes.**

Run: `cd server && npx vitest run __tests__/claude.test.ts -t "buildLaunchCommand resume"`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/src/providers/hook/claude/claude.ts server/__tests__/claude.test.ts
git commit -m "feat(server): buildLaunchCommand resume option"
```

---

### Task 3: AgentState.hasTerminal + AgentRuntime.registerSpawnedAgent

**Files:**

- Modify: `server/src/types.ts` (add field)
- Modify: `server/src/agentRuntime.ts` (add methods)
- Test: `server/__tests__/agentRuntime.spawn.test.ts` (create)

**Interfaces:**

- Consumes: `AgentStateStore` (Task uses `store.nextAgentId`, `store.set`, `store.get`), `startFileWatching`/`JSONL_POLL_INTERVAL_MS` from `fileWatcher.js`/`constants.js`.
- Produces: `AgentState.hasTerminal?: boolean`.
- Produces: `AgentRuntime.registerSpawnedAgent(opts: { sessionId: string; projectDir: string; folderName?: string }): number` — creates an app-spawned (`isExternal:false`, `hasTerminal:true`) AgentState with a fresh id, pre-registers the expected `<sessionId>.jsonl` in `knownJsonlFiles`, stores it (fires `agentAdded`→`agentCreated`), registers it with the hook handler, persists, and starts a JSONL poll that begins file watching once the transcript appears. Returns the new id.
- Produces: `AgentRuntime.markTerminalDetached(id: number): void` — clears `hasTerminal` on the agent if present.

- [ ] **Step 1: Add the AgentState field.** In `server/src/types.ts`, inside `interface AgentState`, after the `hookDelivered: boolean;` line (~line 32) add:

```ts
  /** True when this agent has a live in-app pty terminal (Electron). Not persisted. */
  hasTerminal?: boolean;
```

- [ ] **Step 2: Write the failing test.** Create `server/__tests__/agentRuntime.spawn.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test, verify it fails.**

Run: `cd server && npx vitest run __tests__/agentRuntime.spawn.test.ts`
Expected: FAIL — `registerSpawnedAgent is not a function`.

- [ ] **Step 4: Implement the methods.** In `server/src/agentRuntime.ts`, add these imports to the existing `fileWatcher.js` import block: `readNewLines`, `startFileWatching` (startFileWatching is already imported; add `readNewLines`). Add `import { JSONL_POLL_INTERVAL_MS } from './constants.js';` near the other imports. Then add these two methods inside the `AgentRuntime` class (e.g. after `restoreExternalAgents()`):

```ts
  /**
   * Register an app-spawned (pty-backed) agent. Mirrors the VS Code agentManager
   * launch path, but uses no terminal handle — the live pty lives in the Electron
   * host, keyed by the returned agent id. Pre-registers the expected JSONL so the
   * global scan does not also surface it as an external agent.
   */
  registerSpawnedAgent(opts: { sessionId: string; projectDir: string; folderName?: string }): number {
    const id = this.store.nextAgentId.current++;
    const jsonlFile = path.join(opts.projectDir, `${opts.sessionId}.jsonl`);
    this.knownJsonlFiles.add(jsonlFile);

    const agent: AgentState = {
      id,
      sessionId: opts.sessionId,
      terminalRef: undefined,
      isExternal: false,
      hasTerminal: true,
      projectDir: opts.projectDir,
      jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: opts.folderName,
      hookDelivered: false,
      inputTokens: 0,
      outputTokens: 0,
    };

    this.store.set(id, agent);
    this.registerAgent(agent.sessionId, id);
    this.store.persist();

    // Poll for the transcript to appear, then start watching it.
    const pollTimer = setInterval(() => {
      try {
        if (fs.existsSync(jsonlFile)) {
          clearInterval(pollTimer);
          this.jsonlPollTimers.delete(id);
          startFileWatching(
            id,
            jsonlFile,
            this.store,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
          );
          readNewLines(id, this.store, this.waitingTimers, this.permissionTimers);
        }
      } catch {
        /* file may not exist yet */
      }
    }, JSONL_POLL_INTERVAL_MS);
    this.jsonlPollTimers.set(id, pollTimer);

    return id;
  }

  /** Clear the live-terminal flag for an agent (pty exited). Character stays. */
  markTerminalDetached(id: number): void {
    const agent = this.store.get(id);
    if (agent) agent.hasTerminal = false;
  }
```

- [ ] **Step 5: Run the test, verify it passes.**

Run: `cd server && npx vitest run __tests__/agentRuntime.spawn.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

```bash
git add server/src/types.ts server/src/agentRuntime.ts server/__tests__/agentRuntime.spawn.test.ts
git commit -m "feat(server): registerSpawnedAgent + AgentState.hasTerminal"
```

---

### Task 4: terminalLauncher orchestration

**Files:**

- Create: `server/src/terminalLauncher.ts`
- Test: `server/__tests__/terminalLauncher.test.ts`

**Interfaces:**

- Consumes: `AgentRuntime.registerSpawnedAgent`, `AgentStateStore`, `HostCallbacks` (from Task 5 it gains `onSpawnTerminal`; this task uses the field name `onSpawnTerminal` which Task 5 adds to the interface — define a local structural type here so this task compiles independently), `claudeProvider.buildLaunchCommand`, `claudeProvider.getSessionDirs`.
- Produces: `launchTerminalAgent(ctx, opts: { folderPath?: string; bypassPermissions?: boolean }): void`.
- Produces: `adoptTerminalAgent(ctx, opts: { id: number }): void`.
- Produces: `decodeProjectDirToCwd(projectDir: string): string`.
- The shared `ctx` shape: `{ runtime: AgentRuntime; store: AgentStateStore; onSpawnTerminal?: (o: { id: number; cwd: string; command: string }) => void }`.

- [ ] **Step 1: Write the failing test.** Create `server/__tests__/terminalLauncher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test, verify it fails.**

Run: `cd server && npx vitest run __tests__/terminalLauncher.test.ts`
Expected: FAIL — cannot find module `terminalLauncher.js`.

- [ ] **Step 3: Implement.** Create `server/src/terminalLauncher.ts`:

```ts
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { claudeProvider } from './providers/index.js';

/** Minimal host hook this module needs; the full HostCallbacks adds the rest. */
export interface TerminalLaunchContext {
  runtime: AgentRuntime;
  store: AgentStateStore;
  onSpawnTerminal?: (opts: { id: number; cwd: string; command: string }) => void;
}

function buildCommand(sessionId: string, cwd: string, resume: boolean, bypass?: boolean): string {
  const launch = claudeProvider.buildLaunchCommand?.(sessionId, cwd, {
    resume,
    bypassPermissions: bypass,
  });
  if (!launch) throw new Error('claudeProvider.buildLaunchCommand is not implemented');
  return [launch.command, ...launch.args].join(' ');
}

/** Launch a brand-new agent in an in-app pty (the "+ Agent" path). */
export function launchTerminalAgent(
  ctx: TerminalLaunchContext,
  opts: { folderPath?: string; bypassPermissions?: boolean },
): void {
  const cwd = opts.folderPath || os.homedir();
  const dirs = claudeProvider.getSessionDirs?.(cwd);
  const projectDir = dirs && dirs[0] ? dirs[0] : cwd;
  const sessionId = crypto.randomUUID();
  const command = buildCommand(sessionId, cwd, false, opts.bypassPermissions);

  const id = ctx.runtime.registerSpawnedAgent({ sessionId, projectDir });
  ctx.onSpawnTerminal?.({ id, cwd, command });
  ctx.store.broadcast({ type: 'agentTerminalAttached', id });
}

/** Attach an in-app pty to an existing (external/detached) agent via claude --resume. */
export function adoptTerminalAgent(ctx: TerminalLaunchContext, opts: { id: number }): void {
  const agent = ctx.store.get(opts.id);
  if (!agent) return;
  const cwd = decodeProjectDirToCwd(agent.projectDir);
  const command = buildCommand(agent.sessionId, cwd, true);

  agent.hasTerminal = true;
  ctx.onSpawnTerminal?.({ id: opts.id, cwd, command });
  ctx.store.broadcast({ type: 'agentTerminalAttached', id: opts.id });
}

/**
 * Best-effort reverse of Claude's project-hash encoding (path separators → '-').
 * Used as the cwd for `claude --resume`. Falls back to the home directory when the
 * decoded path does not exist (the hash is lossy for paths containing real dashes).
 */
export function decodeProjectDirToCwd(projectDir: string): string {
  const base = path.basename(projectDir);
  const decoded = base.replace(/-/g, '/');
  return decoded.startsWith('/') ? decoded : os.homedir();
}
```

- [ ] **Step 4: Run the test, verify it passes.**

Run: `cd server && npx vitest run __tests__/terminalLauncher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add server/src/terminalLauncher.ts server/__tests__/terminalLauncher.test.ts
git commit -m "feat(server): terminalLauncher launch + adopt orchestration"
```

---

### Task 5: Wire client messages + HostCallbacks + existingAgents

**Files:**

- Modify: `server/src/clientMessageHandler.ts`
- Test: `server/__tests__/clientMessageHandler.test.ts`

**Interfaces:**

- Consumes: `launchTerminalAgent`, `adoptTerminalAgent` (Task 4).
- Produces: `HostCallbacks` gains `onSpawnTerminal?(opts:{id:number;cwd:string;command:string}):void`, `onTerminalInput?(opts:{id:number;data:string}):void`, `onTerminalResize?(opts:{id:number;cols:number;rows:number}):void`, `onKillTerminal?(id:number):void`.
- Produces: handler cases for `launchAgent`, `adoptAgent`, `terminalInput`, `terminalResize`, `closeAgent`.
- Produces: `existingAgents` payload gains `terminalAgents: Record<number, boolean>`.

- [ ] **Step 1: Write the failing test.** Append to `server/__tests__/clientMessageHandler.test.ts` a new `describe` (match the file's existing imports of `handleClientMessage`, `AgentStateStore`; add `AgentRuntime` and `claudeProvider` imports if missing):

```ts
describe('terminal messages', () => {
  function ctxWith(overrides: Record<string, unknown> = {}) {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    return {
      store,
      runtime,
      base: { store, runtime, cache: null, host: 'electron', ...overrides },
    };
  }

  it('routes terminalInput to onTerminalInput', async () => {
    const onTerminalInput = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onTerminalInput } });
    await handleClientMessage({ type: 'terminalInput', id: 5, data: 'ls\r' }, vi.fn(), base);
    expect(onTerminalInput).toHaveBeenCalledWith({ id: 5, data: 'ls\r' });
  });

  it('routes terminalResize to onTerminalResize', async () => {
    const onTerminalResize = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onTerminalResize } });
    await handleClientMessage(
      { type: 'terminalResize', id: 5, cols: 100, rows: 30 },
      vi.fn(),
      base,
    );
    expect(onTerminalResize).toHaveBeenCalledWith({ id: 5, cols: 100, rows: 30 });
  });

  it('launchAgent spawns via onSpawnTerminal', async () => {
    const onSpawnTerminal = vi.fn();
    const { base } = ctxWith({ hostCallbacks: { onSpawnTerminal } });
    await handleClientMessage({ type: 'launchAgent' }, vi.fn(), base);
    expect(onSpawnTerminal).toHaveBeenCalledOnce();
  });

  it('webviewReady includes terminalAgents for spawned agents', async () => {
    const { store, runtime, base } = ctxWith();
    runtime.registerSpawnedAgent({ sessionId: 's1', projectDir: '/tmp' });
    const sent: Record<string, unknown>[] = [];
    await handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), base);
    const existing = sent.find((m) => m.type === 'existingAgents');
    expect(existing).toBeDefined();
    expect(Object.values(existing!.terminalAgents as Record<number, boolean>)).toContain(true);
    void store;
    runtime.dispose();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails.**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts -t "terminal messages"`
Expected: FAIL — callbacks not invoked / `terminalAgents` undefined.

- [ ] **Step 3: Extend HostCallbacks.** In `server/src/clientMessageHandler.ts`, add to the `HostCallbacks` interface (after `onOpenPath?`):

```ts
  /** Spawn a pty for an agent (Electron). */
  onSpawnTerminal?: (opts: { id: number; cwd: string; command: string }) => void;
  /** Forward keyboard/paste input to an agent's pty. */
  onTerminalInput?: (opts: { id: number; data: string }) => void;
  /** Resize an agent's pty. */
  onTerminalResize?: (opts: { id: number; cols: number; rows: number }) => void;
  /** Kill an agent's pty. */
  onKillTerminal?: (id: number) => void;
```

- [ ] **Step 4: Add the import and handler cases.** At the top of `server/src/clientMessageHandler.ts` add:

```ts
import { adoptTerminalAgent, launchTerminalAgent } from './terminalLauncher.js';
```

Add these cases to the `switch (msg.type)` block (e.g. right before the `default:` case):

```ts
    case 'launchAgent':
      if (runtime) {
        launchTerminalAgent(
          { runtime, store, onSpawnTerminal: ctx.hostCallbacks?.onSpawnTerminal },
          {
            folderPath: msg.folderPath as string | undefined,
            bypassPermissions: msg.bypassPermissions as boolean | undefined,
          },
        );
      }
      break;

    case 'adoptAgent':
      if (runtime) {
        adoptTerminalAgent(
          { runtime, store, onSpawnTerminal: ctx.hostCallbacks?.onSpawnTerminal },
          { id: msg.id as number },
        );
      }
      break;

    case 'terminalInput':
      ctx.hostCallbacks?.onTerminalInput?.({ id: msg.id as number, data: msg.data as string });
      break;

    case 'terminalResize':
      ctx.hostCallbacks?.onTerminalResize?.({
        id: msg.id as number,
        cols: msg.cols as number,
        rows: msg.rows as number,
      });
      break;

    case 'closeAgent':
      ctx.hostCallbacks?.onKillTerminal?.(msg.id as number);
      runtime?.removeAgent(msg.id as number);
      break;
```

- [ ] **Step 5: Add terminalAgents to existingAgents.** In `handleWebviewReady`, in the loop that builds `externalAgents`, also build a `terminalAgents` map and include it in the `existingAgents` send. Replace the existing `existingAgents` block:

```ts
const externalAgents: Record<number, boolean> = {};
const terminalAgents: Record<number, boolean> = {};
for (const [id, agent] of store) {
  agentIds.push(id);
  if (agent.folderName) {
    folderNames[id] = agent.folderName;
  }
  if (agent.isExternal) {
    externalAgents[id] = true;
  }
  if (agent.hasTerminal) {
    terminalAgents[id] = true;
  }
}
const seats = adapter?.loadSeats() ?? {};
send({
  type: 'existingAgents',
  agents: agentIds,
  agentMeta: seats,
  folderNames,
  externalAgents,
  terminalAgents,
});
```

(Remove the now-duplicated original `agentIds.push/externalAgents` loop and `send` — there must be exactly one each.)

- [ ] **Step 6: Run the test + full server suite.**

Run: `cd server && npx vitest run __tests__/clientMessageHandler.test.ts && npx vitest run`
Expected: PASS — the new `terminal messages` describe passes and no existing server test regresses.

- [ ] **Step 7: Commit.**

```bash
git add server/src/clientMessageHandler.ts server/__tests__/clientMessageHandler.test.ts
git commit -m "feat(server): wire terminal client messages + existingAgents.terminalAgents"
```

---

### Task 6: node-pty terminal manager (Electron)

**Files:**

- Create: `adapters/electron/terminalManager.ts`
- Modify: `adapters/electron/package.json` (add `node-pty`)
- Test: `adapters/electron/terminalManager.test.ts`

**Interfaces:**

- Produces: `createTerminalManager(): TerminalManager` where
  `TerminalManager = { spawn(opts:{id:number;cwd:string;command:string}):void; write(id:number,data:string):void; resize(id:number,cols:number,rows:number):void; kill(id:number):void; killAll():void; onData(cb:(id:number,data:string)=>void):void; onExit(cb:(id:number,code:number)=>void):void }`.

- [ ] **Step 1: Add the dependency.** Edit `adapters/electron/package.json` — add a `dependencies` block:

```json
{
  "name": "pixel-agents-electron",
  "private": true,
  "version": "0.0.0",
  "dependencies": {
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write the failing test.** Create `adapters/electron/terminalManager.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const fakePty = {
  _data: null as ((d: string) => void) | null,
  _exit: null as ((e: { exitCode: number }) => void) | null,
  onData(cb: (d: string) => void) {
    this._data = cb;
  },
  onExit(cb: (e: { exitCode: number }) => void) {
    this._exit = cb;
  },
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};
const spawn = vi.fn(() => fakePty);
vi.mock('node-pty', () => ({ spawn }));

const { createTerminalManager } = await import('./terminalManager.js');

describe('terminalManager', () => {
  it('spawns a shell and writes the launch command', () => {
    const m = createTerminalManager();
    m.spawn({ id: 1, cwd: '/tmp', command: 'claude --session-id s1' });
    expect(spawn).toHaveBeenCalledOnce();
    expect(fakePty.write).toHaveBeenCalledWith('claude --session-id s1\r');
  });

  it('routes data with the agent id and forwards input/resize', () => {
    fakePty.write.mockClear();
    const m = createTerminalManager();
    const seen: Array<[number, string]> = [];
    m.onData((id, d) => seen.push([id, d]));
    m.spawn({ id: 7, cwd: '/tmp', command: 'claude' });
    fakePty._data?.('hello');
    expect(seen).toContainEqual([7, 'hello']);
    m.write(7, 'x');
    expect(fakePty.write).toHaveBeenCalledWith('x');
    m.resize(7, 120, 40);
    expect(fakePty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('emits exit and drops the pty', () => {
    const m = createTerminalManager();
    const exits: number[] = [];
    m.onExit((id) => exits.push(id));
    m.spawn({ id: 9, cwd: '/tmp', command: 'claude' });
    fakePty._exit?.({ exitCode: 0 });
    expect(exits).toContain(9);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails.**

Run: `cd adapters/electron && npx vitest run terminalManager.test.ts`
Expected: FAIL — cannot find module `terminalManager.js`.

- [ ] **Step 4: Implement.** Create `adapters/electron/terminalManager.ts`:

```ts
import type { IPty } from 'node-pty';
import { spawn as ptySpawn } from 'node-pty';

export interface TerminalManager {
  spawn(opts: { id: number; cwd: string; command: string }): void;
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  kill(id: number): void;
  killAll(): void;
  onData(cb: (id: number, data: string) => void): void;
  onExit(cb: (id: number, code: number) => void): void;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export function createTerminalManager(): TerminalManager {
  const ptys = new Map<number, IPty>();
  let dataCb: ((id: number, data: string) => void) | null = null;
  let exitCb: ((id: number, code: number) => void) | null = null;

  const shell =
    process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');

  return {
    spawn({ id, cwd, command }) {
      const p = ptySpawn(shell, [], {
        name: 'xterm-color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd,
        env: process.env as Record<string, string>,
      });
      ptys.set(id, p);
      p.onData((d) => dataCb?.(id, d));
      p.onExit(({ exitCode }) => {
        ptys.delete(id);
        exitCb?.(id, exitCode);
      });
      p.write(command + '\r');
    },
    write(id, data) {
      ptys.get(id)?.write(data);
    },
    resize(id, cols, rows) {
      try {
        ptys.get(id)?.resize(cols, rows);
      } catch {
        /* pty may have exited */
      }
    },
    kill(id) {
      ptys.get(id)?.kill();
      ptys.delete(id);
    },
    killAll() {
      for (const p of ptys.values()) p.kill();
      ptys.clear();
    },
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
  };
}
```

- [ ] **Step 5: Install + run the test.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm install node-pty@^1.0.0 --save && cd adapters/electron && npx vitest run terminalManager.test.ts`
Expected: PASS (3 tests). (`node-pty` is installed at the repo root so electron-builder can package and rebuild it; the adapter manifest also lists it for clarity.)

- [ ] **Step 6: Commit.**

```bash
git add adapters/electron/terminalManager.ts adapters/electron/terminalManager.test.ts adapters/electron/package.json package.json package-lock.json
git commit -m "feat(electron): node-pty terminal manager"
```

---

### Task 7: Terminal bridge + main wiring + packaging

**Files:**

- Create: `adapters/electron/terminalBridge.ts`
- Test: `adapters/electron/terminalBridge.test.ts`
- Modify: `adapters/electron/main.ts`
- Modify: `esbuild.js:145` (electron-main externals)
- Modify: `package.json` (root, electron-builder `asarUnpack`)

**Interfaces:**

- Consumes: `TerminalManager` (Task 6), `AgentStateStore.broadcast`.
- Produces: `createTerminalBridge(deps: { manager: TerminalManager; broadcast: (m: Record<string,unknown>) => void; onExit?: (id:number)=>void }): { onSpawnTerminal; onTerminalInput; onTerminalResize; onKillTerminal }` — the four `HostCallbacks` terminal hooks, plus it wires `manager.onData`→broadcast `terminalData` and `manager.onExit`→(`deps.onExit` + broadcast `agentTerminalDetached`).

- [ ] **Step 1: Write the failing test.** Create `adapters/electron/terminalBridge.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test, verify it fails.**

Run: `cd adapters/electron && npx vitest run terminalBridge.test.ts`
Expected: FAIL — cannot find module `terminalBridge.js`.

- [ ] **Step 3: Implement.** Create `adapters/electron/terminalBridge.ts`:

```ts
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
```

- [ ] **Step 4: Run the test, verify it passes.**

Run: `cd adapters/electron && npx vitest run terminalBridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into main.ts.** In `adapters/electron/main.ts`:

Add imports:

```ts
import { createTerminalBridge } from './terminalBridge.js';
import { createTerminalManager } from './terminalManager.js';
```

Add a module-level handle after `let detachAttention`:

```ts
let terminal: ReturnType<typeof createTerminalManager> | null = null;
```

In `ensureServer()`, replace the `const bridge = createNativeBridge({...});` line with:

```ts
terminal = createTerminalManager();
const terminalBridge = createTerminalBridge({
  manager: terminal,
  broadcast: (m) => handle?.store.broadcast(m),
  onExit: (id) => handle?.runtime.markTerminalDetached(id),
});
const bridge = {
  ...createNativeBridge({
    getWindow: () => win,
    broadcast: (m) => handle?.store.broadcast(m),
  }),
  ...terminalBridge,
};
```

In `app.on('before-quit', ...)`, add `terminal?.killAll(); terminal = null;` before `if (handle) stopStandalone(handle);`.

- [ ] **Step 6: Externalize node-pty in the bundle.** In `esbuild.js`, in `buildElectronMain()`, change the `external` array (line ~145) to include `node-pty`:

```js
    external: ['electron', 'node-pty', 'fastify', '@fastify/websocket', '@fastify/static', '@fastify/cors'],
```

- [ ] **Step 7: asarUnpack node-pty for packaging.** In root `package.json`, inside the `build` object, add `node_modules/node-pty/**/*` to `files` and add an `asarUnpack` entry:

```json
    "files": [
      "dist/**/*",
      "node_modules/fastify/**/*",
      "node_modules/@fastify/**/*",
      "node_modules/node-pty/**/*"
    ],
    "asarUnpack": [
      "node_modules/node-pty/**/*"
    ],
```

- [ ] **Step 8: Type-check + electron adapter suite + bundle smoke.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run check-types && cd adapters/electron && npx vitest run && cd ../.. && node esbuild.js`
Expected: PASS — types clean, all electron adapter tests green, `dist/electron-main.js` produced with no node-pty bundling error.

- [ ] **Step 9: Commit.**

```bash
git add adapters/electron/terminalBridge.ts adapters/electron/terminalBridge.test.ts adapters/electron/main.ts esbuild.js package.json
git commit -m "feat(electron): terminal bridge wiring + node-pty packaging"
```

---

### Task 8: Webview deps + xterm terminal client

**Files:**

- Modify: `webview-ui/package.json` (deps)
- Modify: `webview-ui/src/index.css` (import xterm CSS)
- Create: `webview-ui/src/terminal/terminalClient.ts`

**Interfaces:**

- Produces: `writeToTerminal(id:number, data:string):void`, `mountTerminal(id:number, container:HTMLElement):void`, `fitTerminal(id:number):void`, `disposeTerminal(id:number):void`. Each agent gets one persistent xterm `Terminal` (kept in a module-level `Map<number, {term, fit}>`) so scrollback survives tab switches; `term.onData` forwards keystrokes as `terminalInput`.

> Note: the webview test runner is plain Node (no DOM); xterm-dependent code is verified by the build (`tsc -b`) and the E2E/manual smoke (Task 12), not a unit test.

- [ ] **Step 1: Add the dependencies.** Edit `webview-ui/package.json` `dependencies`:

```json
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-resizable-panels": "^2.1.0"
  },
```

- [ ] **Step 2: Install.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo/webview-ui && npm install`
Expected: PASS — packages added.

- [ ] **Step 3: Import xterm CSS.** Add to the top of `webview-ui/src/index.css` (first line):

```css
@import '@xterm/xterm/css/xterm.css';
```

- [ ] **Step 4: Implement the terminal client.** Create `webview-ui/src/terminal/terminalClient.ts`:

```ts
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { transport } from '../transport/index.js';

const TERMINAL_SCROLLBACK = 5000;

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
}

const terminals = new Map<number, TerminalEntry>();

function ensure(id: number): TerminalEntry {
  let entry = terminals.get(id);
  if (!entry) {
    const term = new Terminal({
      fontFamily: 'monospace',
      fontSize: 13,
      scrollback: TERMINAL_SCROLLBACK,
      cursorBlink: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.onData((data) => transport.send({ type: 'terminalInput', id, data }));
    entry = { term, fit };
    terminals.set(id, entry);
  }
  return entry;
}

/** Write pty output into the agent's (possibly offscreen) terminal buffer. */
export function writeToTerminal(id: number, data: string): void {
  ensure(id).term.write(data);
}

/** Attach the agent's terminal element into `container` and fit it. */
export function mountTerminal(id: number, container: HTMLElement): void {
  const { term, fit } = ensure(id);
  if (!term.element) {
    term.open(container);
  } else if (term.element.parentElement !== container) {
    container.appendChild(term.element);
  }
  fit.fit();
  transport.send({ type: 'terminalResize', id, cols: term.cols, rows: term.rows });
  term.focus();
}

/** Recompute size for the agent's terminal and tell the pty. */
export function fitTerminal(id: number): void {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.fit.fit();
  transport.send({ type: 'terminalResize', id, cols: entry.term.cols, rows: entry.term.rows });
}

/** Dispose the agent's terminal (on agentClosed). */
export function disposeTerminal(id: number): void {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.term.dispose();
  terminals.delete(id);
}
```

- [ ] **Step 5: Build to verify it type-checks.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run build:webview`
Expected: PASS — TypeScript + Vite build clean.

- [ ] **Step 6: Commit.**

```bash
git add webview-ui/package.json webview-ui/package-lock.json webview-ui/src/index.css webview-ui/src/terminal/terminalClient.ts
git commit -m "feat(webview): xterm terminal client + deps"
```

---

### Task 9: Webview terminal state + message routing

**Files:**

- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`

**Interfaces:**

- Consumes: `writeToTerminal`, `disposeTerminal` (Task 8).
- Produces: `ExtensionMessageState` gains `terminalAgents: number[]` (agent ids with a live in-app terminal).
- Handles new server messages: `terminalData` → `writeToTerminal`; `terminalError` → write a red error line; `agentTerminalAttached` → add id; `agentTerminalDetached` → remove id; `existingAgents.terminalAgents` → seed; `agentClosed` → also remove from `terminalAgents` and `disposeTerminal`.

- [ ] **Step 1: Add import + state.** In `webview-ui/src/hooks/useExtensionMessages.ts`:

Add import near the other local imports:

```ts
import { disposeTerminal, writeToTerminal } from '../terminal/terminalClient.js';
```

Add `terminalAgents: number[];` to the `ExtensionMessageState` interface (after `host: string;`). Add state near the other `useState` calls:

```ts
const [terminalAgents, setTerminalAgents] = useState<number[]>([]);
```

- [ ] **Step 2: Seed from existingAgents.** In the `existingAgents` branch, after the `setAgents(...)` call, add:

```ts
const termFlags = (msg.terminalAgents || {}) as Record<number, boolean>;
const termIds = Object.keys(termFlags)
  .filter((k) => termFlags[Number(k)])
  .map(Number);
setTerminalAgents((prev) => Array.from(new Set([...prev, ...termIds])));
```

- [ ] **Step 3: Handle the new terminal messages.** Add these `else if` branches inside the `handler` (e.g. after the `agentTokenUsage` branch):

```ts
      } else if (msg.type === 'terminalData') {
        writeToTerminal(msg.id as number, msg.data as string);
      } else if (msg.type === 'terminalError') {
        writeToTerminal(msg.id as number, `\r\n\x1b[31m[error] ${msg.message as string}\x1b[0m\r\n`);
      } else if (msg.type === 'agentTerminalAttached') {
        const id = msg.id as number;
        setTerminalAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } else if (msg.type === 'agentTerminalDetached') {
        const id = msg.id as number;
        setTerminalAgents((prev) => prev.filter((a) => a !== id));
```

- [ ] **Step 4: Clean up on agentClosed.** In the existing `agentClosed` branch, after `os.removeAgent(id);` add:

```ts
setTerminalAgents((prev) => prev.filter((a) => a !== id));
disposeTerminal(id);
```

- [ ] **Step 5: Return the new state.** Add `terminalAgents,` to the returned object at the end of the hook (next to `host,`).

- [ ] **Step 6: Build to verify.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run build:webview`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "feat(webview): terminal state + message routing"
```

---

### Task 10: AgentTabs + TerminalPanel components

**Files:**

- Create: `webview-ui/src/components/AgentTabs.tsx`
- Create: `webview-ui/src/components/TerminalPanel.tsx`

**Interfaces:**

- Produces: `AgentTabs(props: { agents:number[]; focusedAgentId:number|null; statuses:Record<number,string>; terminalAgents:number[]; onFocus:(id:number)=>void })`.
- Produces: `TerminalPanel(props: { focusedAgentId:number|null; hasTerminal:boolean })`.
- Consumes: `mountTerminal`, `fitTerminal` (Task 8); `transport` for `adoptAgent`.

- [ ] **Step 1: Implement AgentTabs.** Create `webview-ui/src/components/AgentTabs.tsx`:

```tsx
interface AgentTabsProps {
  agents: number[];
  focusedAgentId: number | null;
  statuses: Record<number, string>;
  terminalAgents: number[];
  onFocus: (id: number) => void;
}

function statusGlyph(status: string | undefined, hasTerminal: boolean): string {
  if (status === 'waiting') return '✓';
  if (!hasTerminal) return '○';
  return '●';
}

export function AgentTabs({
  agents,
  focusedAgentId,
  statuses,
  terminalAgents,
  onFocus,
}: AgentTabsProps) {
  return (
    <div className="flex flex-col h-full overflow-auto bg-[var(--pixel-bg)]">
      {agents.length === 0 && (
        <div className="p-4 text-sm text-text-muted">No agents yet. Click “+ Agent”.</div>
      )}
      {agents.map((id) => {
        const active = id === focusedAgentId;
        const hasTerminal = terminalAgents.includes(id);
        return (
          <button
            key={id}
            onClick={() => onFocus(id)}
            className={`flex items-center gap-3 px-4 py-3 text-left text-sm border-b-2 border-[var(--pixel-border)] cursor-pointer ${
              active ? 'bg-accent text-white' : 'bg-transparent hover:bg-[var(--pixel-border)]'
            }`}
          >
            <span>{statusGlyph(statuses[id], hasTerminal)}</span>
            <span>Agent {id}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement TerminalPanel.** Create `webview-ui/src/components/TerminalPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react';

import { fitTerminal, mountTerminal } from '../terminal/terminalClient.js';
import { transport } from '../transport/index.js';

interface TerminalPanelProps {
  focusedAgentId: number | null;
  hasTerminal: boolean;
}

export function TerminalPanel({ focusedAgentId, hasTerminal }: TerminalPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusedAgentId == null || !hasTerminal || !ref.current) return;
    const container = ref.current;
    mountTerminal(focusedAgentId, container);
    const ro = new ResizeObserver(() => fitTerminal(focusedAgentId));
    ro.observe(container);
    return () => ro.disconnect();
  }, [focusedAgentId, hasTerminal]);

  if (focusedAgentId == null) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted">
        Select an agent
      </div>
    );
  }

  if (!hasTerminal) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-6 text-text-muted">
        <p className="text-sm">No in-app terminal for this agent (running elsewhere).</p>
        <button
          onClick={() => transport.send({ type: 'adoptAgent', id: focusedAgentId })}
          className="py-3 px-8 bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
        >
          Resume here
        </button>
      </div>
    );
  }

  return <div ref={ref} className="w-full h-full" />;
}
```

- [ ] **Step 3: Build to verify.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run build:webview`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add webview-ui/src/components/AgentTabs.tsx webview-ui/src/components/TerminalPanel.tsx
git commit -m "feat(webview): AgentTabs + TerminalPanel components"
```

---

### Task 11: ElectronShell + App integration + toolbar gating

**Files:**

- Create: `webview-ui/src/components/ElectronShell.tsx`
- Modify: `webview-ui/src/App.tsx`
- Modify: `webview-ui/src/components/BottomToolbar.tsx`

**Interfaces:**

- Produces: `ElectronShell(props: { tabs:ReactNode; office:ReactNode; terminal:ReactNode })` — horizontal `PanelGroup` (left 30% / right 70%) with the left panel a vertical `PanelGroup` (tabs 50% / office 50%); sizes auto-persisted to `localStorage` via `autoSaveId`.
- Consumes: `terminalAgents` and `host` from `useExtensionMessages`; `AgentTabs`, `TerminalPanel`.

- [ ] **Step 1: Implement ElectronShell.** Create `webview-ui/src/components/ElectronShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

interface ElectronShellProps {
  tabs: ReactNode;
  office: ReactNode;
  terminal: ReactNode;
}

export function ElectronShell({ tabs, office, terminal }: ElectronShellProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="pixel-agents-shell-h" className="w-full h-full">
      <Panel defaultSize={30} minSize={15}>
        <PanelGroup direction="vertical" autoSaveId="pixel-agents-shell-v">
          <Panel defaultSize={50} minSize={15}>
            {tabs}
          </Panel>
          <PanelResizeHandle className="h-1 bg-[var(--pixel-border)]" />
          <Panel defaultSize={50} minSize={15}>
            {office}
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className="w-1 bg-[var(--pixel-border)]" />
      <Panel defaultSize={70} minSize={30}>
        {terminal}
      </Panel>
    </PanelGroup>
  );
}
```

- [ ] **Step 2: Integrate into App.tsx.** In `webview-ui/src/App.tsx`:

Add imports:

```ts
import { AgentTabs } from './components/AgentTabs.js';
import { ElectronShell } from './components/ElectronShell.js';
import { TerminalPanel } from './components/TerminalPanel.js';
```

Destructure `terminalAgents` from `useExtensionMessages` (add to the existing destructure list next to `host`).

Add focus state (after the other `useState` calls, ~line 90):

```ts
const [focusedAgentId, setFocusedAgentId] = useState<number | null>(null);
```

Update `handleClick` to also set focus locally:

```ts
const handleClick = useCallback((agentId: number) => {
  const os = getOfficeState();
  const meta = os.subagentMeta.get(agentId);
  const focusId = meta ? meta.parentAgentId : agentId;
  setFocusedAgentId(focusId);
  transport.send({ type: 'focusAgent', id: focusId });
}, []);
```

Change the render tail. Replace the existing `return (` of the office view so the whole office `<div ref={containerRef}>…</div>` is assigned to a const and reused. Concretely, replace `return (` immediately before `<div ref={containerRef} className="w-full h-full relative overflow-hidden">` with:

```tsx
  const officeView = (
```

and replace the matching closing `);` of that top-level return (the `);` immediately after the closing `</div>` that pairs with `containerRef`, right before the final `}` of the component) with:

```tsx
  );

  if (host === 'electron') {
    return (
      <ElectronShell
        tabs={
          <AgentTabs
            agents={agents}
            focusedAgentId={focusedAgentId}
            statuses={agentStatuses}
            terminalAgents={terminalAgents}
            onFocus={(id) => {
              setFocusedAgentId(id);
              transport.send({ type: 'focusAgent', id });
            }}
          />
        }
        office={officeView}
        terminal={
          <TerminalPanel
            focusedAgentId={focusedAgentId}
            hasTerminal={focusedAgentId != null && terminalAgents.includes(focusedAgentId)}
          />
        }
      />
    );
  }

  return officeView;
```

Pass `host` to BottomToolbar (in its JSX usage inside `officeView`): add `host={host}` prop.

- [ ] **Step 3: Gate + Agent by host in BottomToolbar.** In `webview-ui/src/components/BottomToolbar.tsx`:

Add `host: string;` to `BottomToolbarProps`, destructure `host`. Remove the `isBrowserRuntime` import (no longer used). Change the wrapper guard from `{!isBrowserRuntime && (` to:

```tsx
      {(host === 'vscode' || host === 'electron') && (
```

Update `handleAgentClick` so the single-folder path launches an agent in Electron:

```tsx
const handleAgentClick = () => {
  setIsBypassMenuOpen(false);
  pendingBypassRef.current = false;
  if (hasMultipleFolders) {
    setIsFolderPickerOpen((v) => !v);
  } else if (host === 'electron') {
    transport.send({ type: 'launchAgent', bypassPermissions: false });
  } else {
    onOpenClaude();
  }
};
```

- [ ] **Step 4: Build to verify.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run build:webview && npm run check-types`
Expected: PASS — webview builds; root types clean.

- [ ] **Step 5: Commit.**

```bash
git add webview-ui/src/components/ElectronShell.tsx webview-ui/src/App.tsx webview-ui/src/components/BottomToolbar.tsx
git commit -m "feat(webview): Electron 3-panel shell + toolbar gating"
```

---

### Task 12: E2E shell smoke + manual verification

**Files:**

- Create: `e2e/tests/electron-terminal.spec.ts`

**Interfaces:**

- Consumes: the same Playwright-Electron launch pattern as `e2e/tests/electron-app.spec.ts` (read it first to copy the `_electron.launch` boilerplate, executable path, and dist build prerequisite).

> Spawning real `claude` is not available in CI, so the E2E asserts the Electron shell + “+ Agent” button render (host === 'electron'). The full spawn→tab→terminal→character flow is verified by the manual smoke in Step 4.

- [ ] **Step 1: Write the E2E smoke.** Create `e2e/tests/electron-terminal.spec.ts` (adapt the launch boilerplate from `e2e/tests/electron-app.spec.ts`):

```ts
import { _electron as electron, expect, test } from '@playwright/test';
import * as path from 'path';

test('electron shell renders tabs, office and the + Agent button', async () => {
  const root = path.resolve(__dirname, '..', '..');
  const app = await electron.launch({ args: [path.join(root, 'dist', 'electron-main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // The resizable shell is electron-only; its resize handles are present.
  await expect(win.locator('[data-panel-resize-handle-id]').first()).toBeVisible({
    timeout: 15000,
  });
  // + Agent button is shown in electron host.
  await expect(win.getByText('+ Agent')).toBeVisible();

  await app.close();
});
```

- [ ] **Step 2: Build the app bundle so the E2E has something to launch.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run compile`
Expected: PASS — `dist/electron-main.js` + `dist/webview` produced.

- [ ] **Step 3: Run the E2E.**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npx playwright test e2e/tests/electron-terminal.spec.ts`
Expected: PASS — window loads, resize handle + “+ Agent” visible.

- [ ] **Step 4: Manual smoke (record results in the commit body).**

Run: `cd /Users/jpahcecou/Developer/native-pixelagents/repo && npm run dev:electron`
Verify, with `claude` on PATH:

1. The 3-panel shell appears (tabs top-left, office bottom-left, terminal right); drag both splitters — panels resize and sizes persist across an app restart.
2. Click “+ Agent” → a tab appears, a character spawns in the office, and the right panel shows a live terminal running Claude. Type a prompt; the character animates.
3. Run `claude` in an external terminal (e.g. iTerm) → it appears as a character/tab with `○`; clicking its tab shows “Resume here”; clicking it attaches an in-app terminal.
4. Quit and reopen the app → agents return as external (`○`), no terminals auto-spawn.

- [ ] **Step 5: Commit.**

```bash
git add e2e/tests/electron-terminal.spec.ts
git commit -m "test(e2e): electron embedded terminal shell smoke"
```

---

## Self-Review

**Spec coverage:**

- §3 layout split 30/70 + resizable + persisted → Task 11 (ElectronShell `autoSaveId`).
- §3 tabs = all agents; externals → “Resume here”; adopt = attach pty → Tasks 4, 9, 10.
- §3 focus unified tab/character (webview-local) → Task 11 (`focusedAgentId`, both paths).
- §3 restart → external, manual re-adopt → Tasks 3/9 (`hasTerminal` not persisted; webviewReady seeds from live flags only).
- §4 transport A over `/ws` → Tasks 1, 5, 7, 9 (no IPC/preload).
- §5 `AgentState.hasTerminal` + two visible states → Tasks 3, 9, 10.
- §6 message set → Task 1; focusAgent webview-local → Task 11.
- §7 spawn flow (server orchestrates, host runs pty) → Tasks 4, 5, 6, 7.
- §7 adoption + `buildLaunchCommand {resume}` → Tasks 2, 4.
- §8 terminalManager API → Task 6.
- §9 ptyId ephemeral / kill on quit → Tasks 3 (no persist), 7 (`killAll` on `before-quit`).
- §10 errors: spawn fail/exit/backpressure → `terminalError`/`agentTerminalDetached` (Tasks 7, 9). NOTE: pty-data coalescing (backpressure) is NOT separately implemented; xterm tolerates chunked writes and localhost WS is fast — flagged as a follow-up if large-output flooding is observed.
- §11 packaging (node-pty native: external + asarUnpack) → Tasks 6, 7.
- §12 testing → Tasks 2–7 unit; 12 E2E + manual.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. Backpressure deferral is explicitly called out above (not silently dropped).

**Type consistency:** Message field is `id` everywhere (matches existing messages and `existingAgents`). `onSpawnTerminal({id,cwd,command})`, `onTerminalInput({id,data})`, `onTerminalResize({id,cols,rows})`, `onKillTerminal(id)` are identical across Tasks 4 (local type), 5 (HostCallbacks), 6/7 (manager/bridge). `hasTerminal` (server AgentState) ↔ `terminalAgents` (wire map / webview id list) used consistently. `registerSpawnedAgent({sessionId,projectDir,folderName?})` matches between Tasks 3 and 4.

**Known deviations from spec (intentional):** spec named the marker `ptyId`; the plan uses `AgentState.hasTerminal` (boolean) since the live pty map is keyed by agent id in the Electron host — no separate pty identifier is needed. Spec listed a `removeAgent` client message; the plan reuses the existing `closeAgent`. Both keep the contract smaller.
</content>
</invoke>
