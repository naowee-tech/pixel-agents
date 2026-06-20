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
