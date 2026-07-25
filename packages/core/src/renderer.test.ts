import { describe, expect, it } from "vitest";
import { Game } from "./game";
import type { Cell, ContributionGrid } from "./model";
import { LIGHT_THEME, render } from "./renderer";

/** A single-column grid where `rowLevels[row]` sets that day's level directly. */
function makeGrid(rowLevels: Array<0 | 1 | 2 | 3 | 4>): ContributionGrid {
  const week: Cell[] = rowLevels.map((level, row) => ({
    date: `2024-01-0${row + 1}`,
    count: 10,
    level,
  }));
  return { username: "octocat", weeks: [week], total: 70 };
}

type FillRectCall = { fillStyle: string; x: number; y: number; width: number; height: number };

/** A canvas-2d stub that records every fillRect with the fillStyle active at call time. */
function makeFakeContext(): { ctx: CanvasRenderingContext2D; fillRects: FillRectCall[] } {
  const fillRects: FillRectCall[] = [];
  const stub = {
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "top",
    clearRect(): void {},
    fillRect(x: number, y: number, width: number, height: number): void {
      fillRects.push({ fillStyle: String(this.fillStyle), x, y, width, height });
    },
    beginPath(): void {},
    arc(): void {},
    fill(): void {},
    fillText(): void {},
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, fillRects };
}

describe("render", () => {
  it("spawns destruction particles in the brick's last-seen colour, not the destroyed level-0 colour", () => {
    // #given a level-3 brick that has been rendered once while alive
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 3]));
    const brick = game.liveBricks[0];
    render(makeFakeContext().ctx, game, LIGHT_THEME);

    // #when the brick is destroyed and the next frame renders
    brick.level = 0;
    brick.alive = false;
    const second = makeFakeContext();
    render(second.ctx, game, LIGHT_THEME);

    // #then the particles use the level-3 green (the dead brick itself is no longer drawn,
    // so any level-coloured rect in this frame is a particle)
    const styles = second.fillRects.map((call) => call.fillStyle);
    expect(styles).toContain(LIGHT_THEME.colors[3]);
    expect(styles).not.toContain(LIGHT_THEME.colors[1]);
  });
});
