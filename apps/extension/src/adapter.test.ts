import { describe, expect, it } from "vitest";

import type { GameConfig } from "@kusakuzushi/core";
import { computeLayout, DEFAULT_CONFIG, Game, toGrid } from "@kusakuzushi/core";

import { deriveConfig, levelToCount, toExtensionGrid } from "./adapter";
import type { GrassGeometry } from "./grass-dom";

const SYNTHETIC_GEOMETRY: GrassGeometry = {
  cellWidth: 10,
  cellHeight: 10,
  gap: 3,
  cols: 53,
  originX: 67,
  originY: 181,
};

/** Advances `game` until `predicate` holds or `maxSteps` is hit, so tests don't hang if the physics setup is wrong. */
function stepUntil(game: Game, predicate: () => boolean, dt = 0.01, maxSteps = 5000): void {
  let steps = 0;
  while (!predicate() && steps < maxSteps) {
    game.update(dt);
    steps += 1;
  }
}

describe("levelToCount", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 4],
    [3, 9],
    [4, 16],
  ])("level %i -> count %i", (level, expected) => {
    // #given / #when / #then
    expect(levelToCount(level)).toBe(expected);
  });

  it("clamps negative levels to 0", () => {
    // #given / #when / #then
    expect(levelToCount(-1)).toBe(0);
  });
});

describe("toExtensionGrid", () => {
  it("injects count = level^2 for every contributed day, and total is the sum of level^2", () => {
    // #given a small run of days spanning every non-zero level
    const cells = [
      { date: "2026-01-01", level: 0 },
      { date: "2026-01-02", level: 1 },
      { date: "2026-01-03", level: 2 },
      { date: "2026-01-04", level: 3 },
      { date: "2026-01-05", level: 4 },
    ];
    // #when
    const grid = toExtensionGrid("octocat", cells);
    // #then
    const flat = grid.weeks.flat().filter((cell) => cell.date !== "");
    for (const cell of flat) {
      if (cell.level >= 1) {
        expect(cell.count).toBe(cell.level * cell.level);
      }
    }
    expect(grid.total).toBe(0 + 1 + 4 + 9 + 16);
  });
});

describe("deriveConfig + computeLayout geometry alignment", () => {
  it("produces a canvas/brick geometry that lines up 1:1 with the real td rects", () => {
    // #given the real-world measured geometry (10x10 cells, 3px gap, 53 weeks)
    // #when
    const config = deriveConfig(SYNTHETIC_GEOMETRY);
    // #then canvas size matches the derived formula
    expect(config.canvasWidth).toBe(692);
    expect(config.canvasHeight).toBe(194);

    const fullConfig: GameConfig = { ...DEFAULT_CONFIG, ...config };
    const layout = computeLayout(fullConfig, SYNTHETIC_GEOMETRY.cols);
    expect(layout.brickWidth).toBe(10);
    expect(layout.brickHeight).toBe(10);
    expect(layout.brickAreaTop).toBe(3);

    // #and every brick's x/y lines up with the real td's stride (3 + col*13 / 3 + row*13) —
    // y is the more fragile of the two: it depends on deriveConfig's canvasHeight
    // formula (2*(7*cellHeight+9*gap)) rather than the more direct canvasWidth one.
    const week = Array.from({ length: 7 }, (_, row) => ({
      date: `d-${row}`,
      count: 1,
      level: 1 as const,
    }));
    const grid = { username: "octocat", weeks: Array.from({ length: 53 }, () => week), total: 371 };
    const game = new Game(grid, config);
    for (const brick of game.liveBricks) {
      expect(brick.rect.x).toBe(3 + brick.col * 13);
      expect(brick.rect.y).toBe(3 + brick.row * 13);
    }
  });
});

describe("regression: count=level^2 is required for scoring (session 1 review L4)", () => {
  /** A single-column, single-live-brick grid: the only day at row 6 (closest to the paddle) has the given level/count. */
  function makeSingleBrickGrid(level: 0 | 1 | 2 | 3 | 4, count: number): ReturnType<typeof toGrid> {
    const week = [
      { date: "", count: 0, level: 0 as const },
      { date: "", count: 0, level: 0 as const },
      { date: "", count: 0, level: 0 as const },
      { date: "", count: 0, level: 0 as const },
      { date: "", count: 0, level: 0 as const },
      { date: "", count: 0, level: 0 as const },
      { date: "2026-01-01", count, level },
    ];
    return { username: "octocat", weeks: [week], total: count };
  }

  // Single column: the paddle (and therefore the vx=0 launch column) sits
  // dead centre of the only brick column, guaranteeing the ball hits it.
  const singleColumnGeometry: GrassGeometry = { ...SYNTHETIC_GEOMETRY, cols: 1 };
  const config: GameConfig = { ...DEFAULT_CONFIG, ...deriveConfig(singleColumnGeometry) };

  it("scores > 0 when the adapter's count injection is used", () => {
    // #given a grid built the way toExtensionGrid actually builds it (count = level^2 = 1)
    const grid = makeSingleBrickGrid(1, levelToCount(1));
    const game = new Game(grid, config);
    // #when the ball is launched straight up and left to fly
    game.launch();
    stepUntil(game, () => game.state !== "playing");
    // #then the lone brick was destroyed and contributed its count to the score
    expect(game.state).toBe("clear");
    expect(game.score).toBe(1);
  });

  it("scores 0 for the identical hit when count is left at 0 (the bug this adapter prevents)", () => {
    // #given the same brick, same physics, but count=0 as it would be without levelToCount
    const grid = makeSingleBrickGrid(1, 0);
    const game = new Game(grid, config);
    // #when
    game.launch();
    stepUntil(game, () => game.state !== "playing");
    // #then the brick still breaks (level-based), but scores nothing
    expect(game.state).toBe("clear");
    expect(game.score).toBe(0);
  });
});
