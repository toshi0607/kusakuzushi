import { defineConfig, devices } from "@playwright/test";

import { WEBMCP_FLAG } from "./playwright.config";

/**
 * Live-production smoke for the WebMCP surface: the deployed page, the
 * deployed Workers, Chromium with WebMCP on. No servers are started. Run by
 * the deploy workflow after the Workers are out, and by hand:
 *
 *   pnpm test:e2e:prod
 */
export default defineConfig({
  testDir: "./e2e/production",
  workers: 1,
  retries: 2,
  reporter: "line",
  timeout: 90_000,
  use: {
    baseURL: process.env.KUSAKUZUSHI_ORIGIN ?? "https://kusakuzushi.toshi0607.com",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-webmcp",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: [WEBMCP_FLAG] } },
    },
  ],
});
