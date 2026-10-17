import { type Page } from '@playwright/test';

export async function openPanel(page: Page, panel: 'data' | 'fleet' | 'multiplayer' | 'library' | 'tools'): Promise<void> {
  const button = page.locator(`[data-workspace="${panel}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
export async function closePanel(page: Page): Promise<void> {
  await page.locator('[data-workspace="flight"]').click();
}
