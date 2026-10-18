// Playwright 1.64.x WebKit stalls on layered backdrop filters on Linux.
// Keep 1.63.0 pinned until https://github.com/microsoft/playwright/issues/43426 is fully resolved.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 3,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
          },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
