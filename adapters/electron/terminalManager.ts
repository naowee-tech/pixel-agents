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
