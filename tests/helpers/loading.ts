import { expect, type Page } from '@playwright/test';

/** The document load event precedes the deliberately deferred application entry.
 * Observe the same usable-world readiness that releases the player's controls. */
export async function waitForWorldReady(page: Page): Promise<void> {
  await expect(page.locator('#startup-loading')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
}
