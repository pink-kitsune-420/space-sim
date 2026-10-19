import { test, expect, type Page } from '@playwright/test';
import { build, preview, type PreviewServer } from 'vite';
import { resolve } from 'node:path';
import { closePanel, openPanel } from '../helpers/workspace';

// These checks exercise DOM themes; avoid software WebGL consuming the frame budget.
test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, receiver, args) {
        if (String(args[0]).startsWith('webgl')) return null;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
});

async function openTheme(page: Page): Promise<void> {
  await openPanel(page, 'settings');
  await page.locator('#theme-toggle').click();
  await page.locator('[data-tab="tab-hud"]').click();
}

async function palette(page: Page, selector = ':root') {
  return page.locator(selector).evaluate(element => {
    const probe = document.createElement('span');
    element.appendChild(probe);
    probe.style.color = 'var(--ui-win-accent)';
    probe.style.backgroundColor = 'var(--ui-win-card-bg)';
    probe.style.borderColor = 'var(--ui-win-border)';
    const style = getComputedStyle(probe);
    const result = { accent: style.color, card: style.backgroundColor, border: style.borderTopColor };
    probe.remove();
    return result;
  });
}

test('window styles, custom accents, effects and reset stay synchronized across flight interiors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openPanel(page, 'settings');
  await page.locator('#controls-toggle').click();
  await page.locator('#controls-close').click();
  await closePanel(page);
  await expect(page.locator('#settings-window')).toBeHidden();
  await openTheme(page);
  await expect(page.locator('.theme-preset-bar')).toHaveCount(0);
  await expect(page.locator('[data-backdrop="galactic"] strong')).toHaveText('Spacelab Default');
  for (const [style, accent] of [
    ['apollo', 'rgb(255, 179, 0)'], ['solar', 'rgb(255, 215, 0)'],
    ['tactical', 'rgb(255, 102, 0)'], ['cyber', 'rgb(0, 240, 255)'],
    ['crimson', 'rgb(239, 68, 68)'],
  ]) {
    await page.locator(`[data-window-option="${style}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-window-style', style!);
    await expect(page.locator('.theme-tab-btn.active')).toHaveCSS('color', accent!);
    await expect(page.locator('#active-game')).toHaveCSS('color', accent!);
    await expect(page.locator('#window-style-selector .theme-option-card.active')).toHaveCSS('border-top-color', accent!);
    await expect(page.locator('#throttle')).toHaveCSS('accent-color', accent!);
    await expect(page.locator('.chat-msg.system').first()).toHaveCSS('color', accent!);
    const colors = await palette(page);
    await expect(page.locator('.theme-checkbox-card:visible').first()).toHaveCSS('border-top-color', colors.border);
    expect(await palette(page, '#orbit-sandbox-workspace')).toEqual(colors);
    // Check inherited styles when the controls are shown. WebKit caches computed
    // values inside a closed dialog until its contents participate in layout.
    await page.locator('#theme-close').click();
    await page.locator('#controls-toggle').click();
    await expect(page.locator('.key-chip').first()).toHaveCSS('color', accent!);
    await expect(page.locator('.key-action-row').first()).toHaveCSS('background-color', colors.card);
    expect(await palette(page, '#controls-dialog')).toEqual(colors);
    await page.locator('#controls-close').click();
    await openTheme(page);
  }
  await page.locator('#inp-window-color').evaluate((input: HTMLInputElement) => {
    input.value = '#a855f7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.theme-tab-btn.active')).toHaveCSS('color', 'rgb(168, 85, 247)');
  await page.locator('#btn-reset-window-color').click();
  await expect(page.locator('#inp-window-color')).toHaveValue('#ef4444');
  for (const id of ['chk-hud-glow', 'chk-hud-scanlines', 'chk-hud-chamfer']) await page.locator(`#${id}`).check();
  for (const selector of ['html', '#theme-dialog', '#controls-dialog', '.panel-window', '.chat-overlay', '.modal-window', '.inspector-panel']) {
    const elements = page.locator(selector);
    for (let i = 0; i < await elements.count(); i++) {
      await expect(elements.nth(i)).toHaveClass(/hud-glow/);
      await expect(elements.nth(i)).toHaveClass(/hud-scanlines/);
      await expect(elements.nth(i)).toHaveClass(/hud-chamfer/);
    }
  }
  await page.screenshot({ path: info.outputPath('crimson-theme.png') });
  await page.locator('[data-tab="tab-manage"]').click();
  await page.locator('#btn-save-custom-theme').click();
  await page.locator('.theme-preset-card').filter({ hasText: 'Spacelab Default' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-window-style', 'classic');
  await page.locator('.theme-preset-card').filter({ hasText: '★ Custom Theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-window-style', 'crimson');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-window-style', 'crimson');
  await openTheme(page);
  await page.locator('[data-tab="tab-manage"]').click();
  await page.locator('#btn-reset-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-window-style', 'classic');
  await expect(page.locator('html')).not.toHaveClass(/hud-glow|hud-scanlines|hud-chamfer/);
  await expect(page.locator('.theme-tab-btn.active')).toHaveCSS('color', 'rgb(56, 189, 248)');
  expect(errors).toEqual([]);
});

test('Orbit Sandbox inspector and physics, export and testing windows inherit the saved custom palette', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('space-sim:theme:v5', JSON.stringify({
    windowStyle: 'solar', windowColor: '#ffd700', hudGlow: true,
  })));
  await page.goto('/?game=orbit-sandbox');
  await expect(page.locator('#orbit-sandbox-workspace')).toBeVisible();
  const colors = await palette(page);
  for (const selector of ['.inspector-panel', '.modal-window', '.setting-item', '.form-select', '.export-card', '.scenario-card']) {
    for (const element of await page.locator(selector).all()) {
      await expect(element).toHaveCSS('border-top-color', colors.border);
    }
  }
  await expect(page.locator('#rng-radius')).toHaveCSS('accent-color', 'rgb(255, 215, 0)');
  for (const [button, modal] of [['#btn-fullbody-settings', '#modal-fullbody'], ['#btn-export-open', '#modal-export'], ['#btn-testing-open', '#modal-testing']]) {
    await page.locator(button!).click();
    await expect(page.locator(modal!)).toBeVisible();
    await expect(page.locator(`${modal} .modal-window`)).toHaveCSS('background-color', 'rgba(22, 15, 5, 0.96)');
    await page.locator(`${modal} .btn-close`).click();
  }
  await page.locator('#btn-sandbox-theme').click();
  await expect(page.locator('#theme-dialog')).toBeVisible();
  await expect(page.locator('.theme-tab-btn.active')).toHaveCSS('color', 'rgb(255, 215, 0)');
  await page.screenshot({ path: info.outputPath('sandbox-theme.png') });
});

test.describe('standalone Orbit Sandbox', () => {
  let server: PreviewServer;
  test.beforeAll(async ({}, info) => {
    const outDir = resolve(info.project.outputDir, `standalone-theme-${info.project.name}`);
    const configFile = resolve('apps/orbit-sandbox/vite.config.ts');
    await build({ configFile, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    server = await preview({ configFile, logLevel: 'silent', build: { outDir }, preview: { port: 0 } });
  });
  test.afterAll(async () => { await server?.close(); });
  test('restores saved window settings and cycles through every full preset', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('space-sim:theme:v5', JSON.stringify({
      windowStyle: 'crimson', windowColor: '#ef4444', hudGlow: true,
    })));
    await page.goto(server.resolvedUrls!.local[0]!);
    await expect(page.locator('html')).toHaveAttribute('data-window-style', 'crimson');
    await expect(page.locator('#rng-radius')).toHaveCSS('accent-color', 'rgb(239, 68, 68)');
    await expect(page.locator('#modal-fullbody .modal-window')).toHaveCSS('background-color', 'rgba(24, 8, 10, 0.96)');
    const styles = new Set<string>();
    for (let i = 0; i < 9; i++) {
      await page.locator('#btn-theme-open').click();
      styles.add(await page.locator('html').getAttribute('data-window-style') ?? '');
      expect(await palette(page, '.inspector-panel')).toEqual(await palette(page));
    }
    expect([...styles].sort()).toEqual(['apollo', 'aurora', 'classic', 'cyber', 'solar', 'tactical']);
  });
});
