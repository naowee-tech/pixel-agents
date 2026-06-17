import type { MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';

import { APP_NAME } from './config.js';

export interface MenuDeps {
  onFilterToFolder: () => void;
  onClearFilter: () => void;
  onExport: () => void;
  onImport: () => void;
}

export function buildAppMenu(deps: MenuDeps): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Office',
      submenu: [
        { label: 'Filter to Folder…', click: () => deps.onFilterToFolder() },
        { label: 'Clear Filter (Show All)', click: () => deps.onClearFilter() },
        { type: 'separator' },
        { label: 'Export Layout…', click: () => deps.onExport() },
        { label: 'Import Layout…', click: () => deps.onImport() },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

export function applyAppMenu(deps: MenuDeps): void {
  Menu.setApplicationMenu(buildAppMenu(deps));
}
