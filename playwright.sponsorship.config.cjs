const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/sponsorship', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4191', channel: 'chrome', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1050 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'node scripts/dev-sponsorships.cjs --test', url: 'http://127.0.0.1:4191/admin/sponsorships/', reuseExistingServer: false, timeout: 60_000 },
});
