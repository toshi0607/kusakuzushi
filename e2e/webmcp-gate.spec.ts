import { expect, test } from "@playwright/test";

/**
 * Without WebMCP in the browser (Lighthouse's Chrome, everyone's Chrome
 * today), the page must not download the WebMCP module — it is ~85 KB
 * gzipped of MCP client, and lighthouserc.cjs caps the page's scripts at
 * 40 KB. This is the mechanism behind that budget, fixed in a test.
 */
test("a browser without navigator.modelContext never loads the WebMCP chunk", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  await page.goto("/");
  expect(await page.evaluate(() => "modelContext" in navigator)).toBe(false);

  // Registration is scheduled for idle time with a 2s timeout; wait past it.
  await page.waitForTimeout(3000);

  // Fails closed: the page's only script is its entry chunk. Any second
  // chunk — whatever the bundler names it — is a budget regression.
  expect(scripts.length).toBe(1);
  expect(scripts[0]).toMatch(/\/assets\/index-[^/]+\.js$/);
});
