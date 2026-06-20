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
