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
  // Target the button by role: the empty-state AgentTabs hint ("No agents yet.
  // Click '+ Agent'.") also contains the "+ Agent" substring, so getByText is
  // ambiguous (strict-mode violation). getByRole pins the assertion to the button.
  await expect(win.getByRole('button', { name: '+ Agent' })).toBeVisible();

  await app.close();
});
