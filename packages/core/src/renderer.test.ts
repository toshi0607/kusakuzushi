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
type RoundRectCall = { fillStyle: string; x: number; y: number; width: number; height: number; radius: number };
type FillTextCall = { font: string; text: string };

type FakeContext = {
  ctx: CanvasRenderingContext2D;
  fillRects: FillRectCall[];
  roundRects: RoundRectCall[];
  fillTexts: FillTextCall[];
};

/**
 * A canvas-2d stub that records drawing calls with the style active at
 * call time. `withRoundRect` opts into the modern `roundRect` API so both
 * the rounded path and the sharp fallback can be exercised.
 */
function makeFakeContext(withRoundRect = false): FakeContext {
  const fillRects: FillRectCall[] = [];
  const roundRects: RoundRectCall[] = [];
  const fillTexts: FillTextCall[] = [];
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
    fillText(text: string): void {
      fillTexts.push({ font: String(this.font), text });
    },
  };
  if (withRoundRect) {
    Object.assign(stub, {
      roundRect(x: number, y: number, width: number, height: number, radius: number): void {
        roundRects.push({ fillStyle: String(stub.fillStyle), x, y, width, height, radius });
      },
    });
  }
  return { ctx: stub as unknown as CanvasRenderingContext2D, fillRects, roundRects, fillTexts };
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

  it("draws one level-4 grass cell per remaining life instead of a text counter", () => {
    // #given a fresh game (3 lives) with a single low-level brick
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]));
    const fake = makeFakeContext();

    // #when a frame renders
    render(fake.ctx, game, LIGHT_THEME);

    // #then three 10px cells in the strongest green appear, and no "Life" text
    const lifeCells = fake.fillRects.filter((call) => call.fillStyle === LIGHT_THEME.colors[4] && call.width === 10 && call.height === 10);
    expect(lifeCells).toHaveLength(3);
    expect(fake.fillTexts.map((call) => call.text).join(" ")).not.toContain("Life");
  });

  it("uses theme.hudFont for the HUD text when provided", () => {
    // #given a theme carrying a pixel-font stack
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]));
    const fake = makeFakeContext();

    // #when a frame renders with that theme
    render(fake.ctx, game, { ...LIGHT_THEME, hudFont: '"DotGothic16", sans-serif' });

    // #then the score text is drawn with the pixel font
    const scoreCall = fake.fillTexts.find((call) => call.text.startsWith("SCORE"));
    expect(scoreCall?.font).toBe('16px "DotGothic16", sans-serif');
  });

  it("rounds brick corners at 20% of the cell size when roundRect is available", () => {
    // #given a context that supports the modern roundRect API
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 2]));
    const fake = makeFakeContext(true);

    // #when a frame renders
    render(fake.ctx, game, LIGHT_THEME);

    // #then the brick is drawn as a rounded rect with radius = min(w, h) * 0.2
    const brickCall = fake.roundRects.find((call) => call.fillStyle === LIGHT_THEME.colors[2]);
    expect(brickCall).toBeDefined();
    const expected = Math.min(brickCall!.width, brickCall!.height) * 0.2;
    expect(brickCall!.radius).toBeCloseTo(expected);
  });

  it("keeps drawing bricks as sharp rects when roundRect is missing", () => {
    // #given a context without roundRect (older canvas / test stubs)
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 2]));
    const fake = makeFakeContext();

    // #when a frame renders
    render(fake.ctx, game, LIGHT_THEME);

    // #then the brick still appears via the fillRect fallback
    const brickCall = fake.fillRects.find((call) => call.fillStyle === LIGHT_THEME.colors[2]);
    expect(brickCall).toBeDefined();
  });
});
