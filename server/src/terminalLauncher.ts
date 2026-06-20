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
