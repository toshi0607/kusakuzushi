import { describe, expect, it, vi } from "vitest";

import type { AppController, AppSnapshot } from "../app";
import { createPageTools, startGame, TOOL_OUTPUT_CHAR_LIMIT } from "./tools";

function controller(snapshot: Partial<AppSnapshot> = {}): AppController & { start: ReturnType<typeof vi.fn<(username: string) => void>> } {
  return {
    start: vi.fn<(username: string) => void>(),
    getSnapshot: () => ({
      phase: "idle",
      user: null,
      score: null,
      harvestedPercent: null,
      lives: null,
      bricksLeft: null,
      totalContributions: null,
      ...snapshot,
    }),
  };
}

describe("start_game", () => {
  it("starts through the controller for a valid username", () => {
    const app = controller();

    expect(startGame(app, { user: "toshi0607" })).toEqual({ started: true, user: "toshi0607" });
    expect(app.start).toHaveBeenCalledWith("toshi0607");
  });

  it("refuses invalid names before the controller, without echoing them", () => {
    const app = controller();
    const long = "x".repeat(2000);

    for (const user of [long, "not_valid", "", "a/b", 42, undefined, "<img>"]) {
      const result = startGame(app, { user });
      expect(result.started).toBe(false);
      expect(JSON.stringify(result)).not.toContain("not_valid");
      expect(JSON.stringify(result)).not.toContain("xxxx");
      expect(JSON.stringify(result)).not.toContain("<img>");
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
    }
    expect(app.start).not.toHaveBeenCalled();
  });

  it("refuses to start while a round is in progress or a grid is loading, but not on a settled board", () => {
    for (const phase of ["playing", "ballLost"] as const) {
      const app = controller({ phase, user: "someone" });
      expect(startGame(app, { user: "toshi0607" })).toMatchObject({ started: false });
      expect(app.start).not.toHaveBeenCalled();
    }
    {
      const app = controller({ phase: "loading", user: "someone" });
      expect(startGame(app, { user: "toshi0607" })).toMatchObject({ started: false });
      expect(app.start).not.toHaveBeenCalled();
    }
    for (const phase of ["idle", "empty", "error", "ready", "gameOver", "clear"] as const) {
      const app = controller({ phase, user: "someone" });
      expect(startGame(app, { user: "toshi0607" })).toMatchObject({ started: true });
      expect(app.start).toHaveBeenCalledTimes(1);
    }
  });
});

describe("page tools", () => {
  it("exposes exactly the two page tools with their read-only hints", () => {
    const tools = createPageTools(controller());

    expect(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint])).toEqual([
      ["start_game", false],
      ["get_game_state", true],
    ]);
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(500);
    }
  });

  it("returns the snapshot within the output budget", async () => {
    const tools = createPageTools(
      controller({ phase: "playing", user: "toshi0607", score: 12340, harvestedPercent: 87, lives: 2, bricksLeft: 41, totalContributions: 2942 }),
    );
    const state = tools.find((tool) => tool.name === "get_game_state")!;

    const result = await state.execute({});

    expect(result).toEqual({ phase: "playing", user: "toshi0607", score: 12340, harvestedPercent: 87, lives: 2, bricksLeft: 41, totalContributions: 2942 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(TOOL_OUTPUT_CHAR_LIMIT);
  });
});
