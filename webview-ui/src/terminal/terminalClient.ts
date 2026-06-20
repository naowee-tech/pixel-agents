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
      // xterm requires a monospace font; FS Pixel Sans is a UI display font, not terminal-suitable.
      // eslint-disable-next-line pixel-agents/pixel-font
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
