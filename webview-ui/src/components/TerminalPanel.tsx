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
