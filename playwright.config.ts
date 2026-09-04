import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the WebMCP surface (e2e/*.spec.ts). Three local servers:
 *
 *   - wrangler dev for the OGP Worker on 8788 and for the MCP Worker on 8787.
 *     Two sessions rather than one multi-config session because the page
 *     needs /api (OGP) and /mcp (MCP) on their own ports, as the zone routes
 *     split them in production; wrangler's local registry connects the MCP
 *     Worker's Service Binding to the OGP session. Durable Objects and rate
 *     limiters run in miniflare.
 *   - vite preview on 4173 serving the production build, proxying /api and
 *     /mcp to those ports (vite.config.ts) so the page sees one origin, as it
 *     does behind Cloudflare.
 *
 * The Workers reach the real jogruber API; the deploy smoke tests do too.
 * The live-production smoke lives in e2e/production and runs only through
 * playwright.production.config.ts.
 */
const OGP_PORT = 8788;
const MCP_PORT = 8787;
const WEB_PORT = 4173;
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export const WEBMCP_FLAG = "--enable-experimental-web-platform-features";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/production/**",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "line",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-webmcp",
      testMatch: /webmcp\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { args: [WEBMCP_FLAG] } },
    },
    {
      name: "chromium-plain",
      testMatch: /webmcp-gate\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // wrangler lives in the Worker packages, not at the root.
      command: `pnpm --filter @kusakuzushi/ogp exec wrangler dev --port ${OGP_PORT} --ip 127.0.0.1`,
      port: OGP_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // The preview origin is allowed through workers/mcp/.dev.vars.
      command: `pnpm --filter @kusakuzushi/mcp exec wrangler dev --port ${MCP_PORT} --ip 127.0.0.1`,
      port: MCP_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @kusakuzushi/web build && pnpm --filter @kusakuzushi/web exec vite preview --host 127.0.0.1 --port ${WEB_PORT}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        KUSAKUZUSHI_API_PROXY: `http://127.0.0.1:${OGP_PORT}`,
        KUSAKUZUSHI_MCP_PROXY: `http://127.0.0.1:${MCP_PORT}`,
      },
    },
  ],
});
