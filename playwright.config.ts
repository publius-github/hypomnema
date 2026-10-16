import { defineConfig, devices } from "@playwright/test";

// End-to-end tests of the real frontend bundle in Chromium, with the
// Rust core replaced by the in-memory fake in e2e/app/backend.ts. They
// cover what the window does - navigation, forms, task flows - not the
// core's logic, which the Rust tests own.
//
// The visual baselines (`*.visual.spec.ts`) are rendered fonts and
// pixels, so they are per platform: run `npm run e2e:visual` on the
// machine that made them. CI runs the functional specs only.
const PORT = 1430;

export default defineConfig({
  testDir: "e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/e2e/app/index.html`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /\.visual\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "visual",
      testMatch: /\.visual\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "npx vite build --config e2e/vite.config.ts && npx vite preview --config e2e/vite.config.ts",
    url: `http://localhost:${PORT}/e2e/app/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
