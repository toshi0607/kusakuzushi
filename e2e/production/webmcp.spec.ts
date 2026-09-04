import { expect, test } from "@playwright/test";

import { ALL_TOOLS, listedToolNames, runTool, TOOL_OUTPUT_CHAR_LIMIT } from "../fixtures";

/**
 * Against the deployed site: the page registers its tools, the bridge
 * reaches the deployed MCP Worker at the same origin, and a remote tool
 * answers through the Service Binding to the deployed OGP Worker.
 */
test("the deployed page mirrors the deployed Worker's tools and they answer", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).ModelContext)).toBe("function");

  await expect.poll(() => listedToolNames(page), { timeout: 45_000 }).toEqual(ALL_TOOLS);

  const state = await runTool(page, "get_game_state");
  expect(state.value).toMatchObject({ phase: "idle" });

  const grid = await runTool(page, "remote.get_contribution_grid", { user: "toshi0607" });
  expect(grid.text.length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
  expect((grid.value as { weeks: string[] }).weeks.length).toBeGreaterThanOrEqual(52);
});
