const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/soak',
  testMatch: '**/*.soak.js',
  timeout: Math.max(90_000, Number(process.env.NEON_SOAK_MS || 180_000) + 45_000),
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: './test/e2e/global-setup.js',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4190',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    { name: 'chromium-soak', use: { ...devices['Desktop Chrome'] } }
  ]
});
