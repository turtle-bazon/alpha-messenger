import { defineConfig, devices } from '@playwright/test';

// E2E гоняются против реального docker-стека (server + PostgreSQL из run/).
// Сам web-клиент Playwright поднимает сам (vite dev) и держит до конца прогона.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // The UI language is auto-detected from the browser (#58); pin it to
    // Russian so specs asserting on Russian UI text stay deterministic.
    locale: 'ru-RU',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
