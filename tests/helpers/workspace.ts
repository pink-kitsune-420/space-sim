import { type Page } from '@playwright/test';

export type WorkspacePanel = 'setup' | 'data' | 'fleet' | 'multiplayer' | 'library' | 'tools';

export async function openPanel(page: Page, panel: WorkspacePanel = 'setup'): Promise<void> {
  await page.evaluate((target: string) => {
    document.querySelector<HTMLButtonElement>(`[data-workspace="${target}"]`)?.click();
  }, panel);
}
export async function closePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const drawer = document.getElementById('workspace-drawer');
    if (drawer && !drawer.hidden) drawer.querySelector<HTMLButtonElement>('.drawer-close')?.click();
  });
}
