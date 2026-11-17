import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: process.env.CHROMIUM_PATH || process.env.CI_SYSTEM_CHROMIUM
      ? { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' }
      : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
