import { type Page } from '@playwright/test';

export type WorkspacePanel = 'setup' | 'data' | 'fleet' | 'multiplayer' | 'library' | 'tools';

export async function openPanel(page: Page, panel: WorkspacePanel = 'setup'): Promise<void> {
  await page.evaluate((target: string) => {
    const drawer = document.getElementById('workspace-drawer');
    if (drawer?.hidden) document.getElementById('menu-toggle')?.click();
    const button = document.querySelector<HTMLButtonElement>(`[data-workspace="${target}"]`);
    if (button && button.getAttribute('aria-expanded') !== 'true') button.click();
  }, panel);
}
export async function closePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const drawer = document.getElementById('workspace-drawer');
    if (drawer && !drawer.hidden) document.querySelector<HTMLButtonElement>('[data-workspace="flight"]')?.click();
  });
}
