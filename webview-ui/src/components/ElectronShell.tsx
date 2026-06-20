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
