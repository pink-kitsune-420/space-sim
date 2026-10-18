import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { useCanvas } from '../helpers/canvas';
import { disableNetwork } from '../helpers/offline';

test('offline checks block HTTP navigation while local HTML still flies', async ({ page, context }) => {
  await useCanvas(page);
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await disableNetwork(context);
  await expect(page.goto('/')).rejects.toThrow();
  await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#flight-view').focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.up('Space');
});
