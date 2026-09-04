import { expect, test, type Page } from "@playwright/test";

import { ALL_TOOLS, listedToolNames, runTool, storageFingerprint, TOOL_OUTPUT_CHAR_LIMIT } from "./fixtures";

const USER = "toshi0607";

/** Where the page may talk to. Fonts are the pre-existing third party; everything else is its own origin (Workers included, via the proxy). */
const ALLOWED_HOSTS = new Set(["127.0.0.1:4173", "fonts.googleapis.com", "fonts.gstatic.com"]);

function watchNetwork(page: Page): { offending: () => string[]; sockets: () => string[] } {
  const offending: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!ALLOWED_HOSTS.has(url.host)) offending.push(request.url());
  });
  page.on("websocket", (socket) => sockets.push(socket.url()));
  return { offending: () => offending, sockets: () => sockets };
}

test.describe("WebMCP on the page", () => {
  test("registers the page tools and mirrors the Worker's tools on Chromium's native API", async ({ page }) => {
    const network = watchNetwork(page);
    await page.goto("/");

    // #given — the API is genuinely native here
    expect(await page.evaluate(() => typeof (globalThis as Record<string, unknown>).ModelContext)).toBe("function");

    // #then — the browser lists all four, the remote ones under their prefix
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);
    expect(network.offending()).toEqual([]);
    expect(network.sockets()).toEqual([]);
  });

  test("answers remote.get_contribution_grid through the bridge as a string within the budget", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);

    const { value, text } = await runTool(page, "remote.get_contribution_grid", { user: USER });

    // The adapter flattens MCP content to one string; Chromium's tool runner
    // hands a string result back verbatim (see e2e/fixtures.ts), so what the
    // test can fix is the budget on that text and its shape once decoded.
    expect(text.length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    const grid = value as { user: string; weeks: string[]; total: number };
    expect(grid.user).toBe(USER);
    expect(grid.weeks.length).toBeGreaterThanOrEqual(52);
    expect(grid.weeks.length).toBeLessThanOrEqual(53);
    expect(grid.weeks.every((week) => /^[0-4]{7}$/.test(week))).toBe(true);
    expect(grid.total).toBeGreaterThan(0);
  });

  test("refuses an invalid username on both sides without echoing it", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);

    const local = await runTool(page, "start_game", { user: "not_valid" });
    expect(local.value).toMatchObject({ started: false });
    expect(local.text).not.toContain("not_valid");

    // A remote tool error becomes a thrown error in the page (the adapter rethrows isError results).
    const remote = await page.evaluate(async () => {
      const testing = (navigator as unknown as { modelContextTesting: { executeTool(name: string, input: string): Promise<string> } }).modelContextTesting;
      try {
        return { ok: true, result: await testing.executeTool("remote.get_contribution_grid", JSON.stringify({ user: "not_valid" })) };
      } catch (error) {
        return { ok: false, result: String(error) };
      }
    });
    expect(remote.ok).toBe(false);
    expect(remote.result).not.toContain("not_valid");
  });

  test("a full circuit of every tool leaves the browser's storage byte-identical", async ({ page }) => {
    const network = watchNetwork(page);
    await page.goto("/");
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);
    const before = await storageFingerprint(page);

    // #when — every tool, success and refusal paths alike
    await runTool(page, "get_game_state");
    await runTool(page, "remote.get_contribution_grid", { user: USER });
    await runTool(page, "remote.render_share_card", { user: USER, percentage: 12 });
    await runTool(page, "start_game", { user: USER });
    await expect.poll(async () => ((await runTool(page, "get_game_state")).value as { phase: string }).phase, { timeout: 30_000 }).toBe("ready");
    await runTool(page, "start_game", { user: "not_valid" });
    await runTool(page, "get_game_state");

    // #then
    expect(await storageFingerprint(page)).toBe(before);
    expect(network.offending()).toEqual([]);
    expect(network.sockets()).toEqual([]);
  });

  test("start_game runs the same flow as the form, is refused mid-round, and persists nothing", async ({ page }) => {
    const network = watchNetwork(page);
    await page.goto("/");
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);
    const before = await storageFingerprint(page);

    // #given — an idle page
    expect((await runTool(page, "get_game_state")).value).toMatchObject({ phase: "idle", user: null });

    // #when — an agent starts a game
    expect((await runTool(page, "start_game", { user: USER })).value).toEqual({ started: true, user: USER });

    // #then — the grid loads through the page's own path and the board is ready
    await expect.poll(async () => (await runTool(page, "get_game_state")).value, { timeout: 30_000 }).toMatchObject({ phase: "ready", user: USER });
    const ready = (await runTool(page, "get_game_state")).value as { totalContributions: number; bricksLeft: number; lives: number };
    expect(ready.totalContributions).toBeGreaterThan(0);
    expect(ready.bricksLeft).toBeGreaterThan(0);
    expect(ready.lives).toBe(3);
    expect(page.url()).toContain(`?user=${USER}`);

    // #when — the player launches the ball
    await page.locator("canvas.game-canvas").focus();
    await page.keyboard.press("Space");
    await expect.poll(async () => ((await runTool(page, "get_game_state")).value as { phase: string }).phase).toBe("playing");

    // #then — a second start is refused, and the round goes on
    expect((await runTool(page, "start_game", { user: "octocat" })).value).toMatchObject({ started: false });
    expect(((await runTool(page, "get_game_state")).value as { user: string }).user).toBe(USER);

    // #then — nothing was written anywhere, and nothing left the origin but fonts
    expect(await storageFingerprint(page)).toBe(before);
    expect(network.offending()).toEqual([]);
    expect(network.sockets()).toEqual([]);
  });

  test("remote.render_share_card returns URLs and a post, never the image, within the budget", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => listedToolNames(page), { timeout: 30_000 }).toEqual(ALL_TOOLS);
    const before = await storageFingerprint(page);

    const { value, text } = await runTool(page, "remote.render_share_card", { user: USER, percentage: 56, score: 1234 });

    expect(text.length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    const card = value as Record<string, unknown>;
    expect(card.imageUrl).toBe(`https://kusakuzushi.toshi0607.com/share/${USER}/og.png?s=1234&p=56`);
    expect(card.shareUrl).toBe(`https://kusakuzushi.toshi0607.com/share/${USER}?s=1234&p=56`);
    expect(String(card.postText)).toContain("56% 刈り取った");
    expect(card.imageContentType).toBe("image/png");
    expect(card.imageBytes as number).toBeGreaterThan(1000);
    expect(text).not.toContain("data:image");
    expect(await storageFingerprint(page)).toBe(before);
  });
});
