import { test, expect } from '@playwright/test';
import { openPanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });

test('manual shows player and creator docs with live keys', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'manual');
  const manual = page.locator('#manual-window');
  await expect(manual).toBeVisible();
  await expect(manual.locator('#manual-tab-players')).toHaveAttribute('aria-selected', 'true');

  // The controls page is generated from the current keybindings.
  await manual.locator('.manual-topic[data-page="controls"]').click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Controls');
  await expect(manual.locator('.manual-controls caption')).toHaveText(['Flight', 'Time warp', 'Camera & view', 'System']);
  await expect(manual.locator('.manual-controls tr', { hasText: 'Fire Main Engine' }).locator('kbd')).toHaveText(['Space']);

  // In-page links and search.
  await manual.locator('#manual-tab-creators').click();
  await manual.locator('#manual-page a[data-page="shaders"]').click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Shader packs');
  await manual.locator('#manual-search').fill('determin');
  await expect(manual.locator('.manual-topic b')).toHaveText(['Rules for simulation modules']);
  await manual.locator('#manual-search').fill('zzzz');
  await expect(manual.locator('.manual-empty')).toHaveText('No pages match.');

  // The chosen audience and page survive a reload.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'manual');
  await expect(manual.locator('#manual-tab-creators')).toHaveAttribute('aria-selected', 'true');
  await expect(manual.locator('#manual-page h2')).toHaveText('Shader packs');
});
