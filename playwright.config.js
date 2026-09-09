const { defineConfig, devices } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: {
    channel: process.env.CI ? undefined : "chrome",
    baseURL: process.env.SITE_URL || "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.SITE_URL
    ? undefined
    : {
        command: "python3 -m http.server 4173 --directory dist",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
      },
});
