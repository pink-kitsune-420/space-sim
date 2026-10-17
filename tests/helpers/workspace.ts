import { type Page } from '@playwright/test';

export type WorkspacePanel = 'setup' | 'ship' | 'fleet' | 'multiplayer' | 'data' | 'settings' | 'tools' | 'manual' | 'library';

/** Open a section window from the dock (or bring it to the front if it is already open). */
export async function openPanel(page: Page, panel: WorkspacePanel = 'setup'): Promise<void> {
  await page.evaluate((target: string) => {
    const window = document.getElementById(`${target}-window`);
    if (window && !window.hidden && window.classList.contains('front')) return;
    document.querySelector<HTMLButtonElement>(`[data-workspace="${target}"]`)?.click();
  }, panel);
}
/** Close every open section window, returning focus to the flight view. */
export async function closePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const close of document.querySelectorAll<HTMLButtonElement>('.panel-window:not([hidden]) [data-window-close]')) close.click();
  });
}
