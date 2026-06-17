import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test('electron app launches and renders the office canvas', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'dist', 'electron-main.js')],
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // The office renders into a <canvas>.
  await expect(window.locator('canvas')).toBeVisible({ timeout: 15000 });
  await app.close();
});
