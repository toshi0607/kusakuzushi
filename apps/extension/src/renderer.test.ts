/**
 * The overlay renderer has to keep up with everything core's `Game` can put
 * on the board — not just the first ball and the main paddle. A ball the
 * player can't see is worse than no power-up at all, so these tests drive a
 * real `Game` into each state and read back the draw calls.
 */

import { describe, expect, it } from "vitest";

import type { GameConfig } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, Game } from "@kusakuzushi/core";

import { createOverlayRenderer } from "./renderer";
import type { OverlayTheme } from "./renderer";

const THEME: OverlayTheme = {
  levelColors: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  paddleColor: "#24292f",
  ballColor: "#0969da",
  textColor: "#24292f",
};

type FillRectCall = { fillStyle: string; x: number; y: number; width: number; height: number };

type FakeContext = { ctx: CanvasRenderingContext2D; fillRects: FillRectCall[]; arcs: number };

function makeFakeContext(): FakeContext {
  const fillRects: FillRectCall[] = [];
  const state = { arcs: 0 };
  const stub = {
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "bottom",
    shadowColor: "",
    shadowBlur: 0,
    clearRect(): void {},
    fillRect(x: number, y: number, width: number, height: number): void {
      fillRects.push({ fillStyle: String(this.fillStyle), x, y, width, height });
    },
    beginPath(): void {},
    arc(): void {
      state.arcs += 1;
    },
    fill(): void {},
    fillText(): void {},
    measureText(): { width: number } {
      return { width: 40 };
    },
  };
  const fake = { ctx: stub as unknown as CanvasRenderingContext2D, fillRects, arcs: 0 };
  Object.defineProperty(fake, "arcs", { get: () => state.arcs });
  return fake;
}

/**
 * The same board core's own tests use for items: a narrow paddle parked at
 * x=20 catches the ball and anything the col0 target brick drops, while a
 * column of level-4 decoys stops the board clearing mid-test.
 */
const ITEM_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  canvasWidth: 100,
  canvasHeight: 200,
  brickGapPx: 0,
  paddleWidth: 40,
  paddleHeight: 10,
  paddleMarginBottom: 0,
  ballRadius: 5,
  ballSpeed: 100,
  itemDropChance: 1,
  itemFallSpeed: 100,
  itemSize: 10,
};

function playUntil(kindRoll: number, predicate: (game: Game) => boolean): Game {
  const target = Array.from({ length: 7 }, (_, row) => ({
    date: `2024-01-0${row + 1}`,
    count: 10,
    level: (row === 6 ? 1 : 0) as 0 | 1,
  }));
  const decoys = Array.from({ length: 7 }, (_, row) => ({
    date: `2024-01-1${row + 1}`,
    count: 10,
    level: 4 as const,
  }));
  const game = new Game({ username: "octocat", weeks: [target, decoys], total: 20 }, { ...ITEM_CONFIG, random: () => kindRoll });

  game.movePaddle(20);
  game.launch();
  for (let step = 0; step < 5000 && !predicate(game); step++) {
    game.update(0.01);
  }
  if (!predicate(game)) throw new Error("playUntil: predicate never held");
  return game;
}

describe("createOverlayRenderer", () => {
  it("draws every ball, not just the primary one, after a multiBall catch", () => {
    // #given three balls in play
    const game = playUntil(0, (g) => g.ballStates.length === 3);
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then all three are drawn
    expect(fake.arcs).toBe(3);
  });

  it("draws the extraPaddle side bars alongside the main paddle", () => {
    // #given the side bars are out
    const game = playUntil(0.9, (g) => g.paddleStates.length === 3);
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then three paddle-coloured bars share the paddle's row
    const bars = fake.fillRects.filter((call) => call.fillStyle === THEME.paddleColor);
    expect(bars).toHaveLength(3);
    expect(bars.every((call) => call.y === game.paddleState.y)).toBe(true);
  });

  it("draws a falling item as a tile with a knocked-out glyph", () => {
    // #given an item on its way down
    const game = playUntil(0, (g) => g.itemStates.length > 0);
    const item = game.itemStates[0];
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then the tile sits on the item's centre...
    const tile = fake.fillRects.find((call) => call.fillStyle === THEME.ballColor && call.width === item.size);
    expect(tile).toMatchObject({ x: item.x - item.size / 2, y: item.y - item.size / 2, height: item.size });

    // #and its three marks are knocked out in the level-0 grass colour
    const marks = fake.fillRects.filter((call) => call.fillStyle === THEME.levelColors[0]);
    expect(marks).toHaveLength(3);
  });
});
