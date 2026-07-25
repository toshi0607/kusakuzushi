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

const PAGE_BACKGROUND = "#ffffff";

const THEME: OverlayTheme = {
  levelColors: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  paddleColor: "#24292f",
  ballColor: "#24292f",
  textColor: "#24292f",
  backgroundColor: PAGE_BACKGROUND,
  itemColors: { multiBall: "#0969da", extraPaddle: "#8250df" },
};

type FillRectCall = { fillStyle: string; x: number; y: number; width: number; height: number; alpha: number };
type TextCall = { text: string; x: number; y: number; fillStyle: string };

type FakeContext = {
  ctx: CanvasRenderingContext2D;
  fillRects: FillRectCall[];
  texts: TextCall[];
  arcs: number;
};

function makeFakeContext(): FakeContext {
  const fillRects: FillRectCall[] = [];
  const texts: TextCall[] = [];
  const state = { arcs: 0 };
  // No `roundRect` here on purpose: the renderer's square fallback is what
  // these assertions read, and it is the same rectangle either way.
  const stub = {
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "bottom",
    clearRect(): void {},
    fillRect(x: number, y: number, width: number, height: number): void {
      fillRects.push({ fillStyle: String(this.fillStyle), x, y, width, height, alpha: Number(this.globalAlpha) });
    },
    beginPath(): void {},
    arc(): void {
      state.arcs += 1;
    },
    fill(): void {},
    fillText(text: string, x: number, y: number): void {
      texts.push({ text, x, y, fillStyle: String(this.fillStyle) });
    },
    measureText(): { width: number } {
      return { width: 40 };
    },
  };
  const fake = { ctx: stub as unknown as CanvasRenderingContext2D, fillRects, texts, arcs: 0 };
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
    // #given more than one ball in play
    const game = playUntil(0, (g) => g.ballStates.length > 1);
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then every ball is drawn
    expect(fake.arcs).toBe(game.ballStates.length);
    expect(fake.arcs).toBeGreaterThan(1);
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
    const tile = fake.fillRects.find(
      (call) => call.fillStyle === THEME.itemColors[item.kind] && call.width === item.size,
    );
    expect(tile).toMatchObject({ x: item.x - item.size / 2, y: item.y - item.size / 2, height: item.size });

    // #and its three marks are knocked out in the level-0 grass colour
    const marks = fake.fillRects.filter((call) => call.fillStyle === THEME.levelColors[0]);
    expect(marks).toHaveLength(3);
  });

  it("backs each HUD label with a plate in the page background colour", () => {
    // #given a game in play. The overlay canvas is transparent, so without a
    // plate the HUD is bare text over whatever GitHub renders below the grass
    // — which is how Score and Life became unreadable on a real profile.
    const game = playUntil(0, (g) => g.score > 0);
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then both labels are drawn in the text colour...
    const labels = fake.texts.filter((call) => call.fillStyle === THEME.textColor);
    expect(labels.map((call) => call.text)).toEqual([`Score: ${game.score}`, `Life: ${game.life}`]);

    // #and each sits on its own plate in the page background, drawn behind it
    const plates = fake.fillRects.filter((call) => call.fillStyle === PAGE_BACKGROUND);
    expect(plates).toHaveLength(2);
    for (const [index, plate] of plates.entries()) {
      const label = labels[index];
      expect(plate.alpha).toBeLessThan(1);
      expect(plate.x).toBeLessThan(label.x);
      // 40 is the stubbed `measureText` width
      expect(plate.x + plate.width).toBeGreaterThan(label.x + 40);
      expect(plate.y).toBeLessThan(label.y);
      expect(plate.y + plate.height).toBeGreaterThan(label.y);
    }
  });

  it("shows the launch guide only while the ball is waiting to be launched", () => {
    // #given a board that has not been launched yet
    const grid = { username: "octocat", weeks: [[{ date: "2024-01-01", count: 10, level: 4 as const }]], total: 10 };
    const ready = new Game(grid, ITEM_CONFIG);
    const readyFrame = makeFakeContext();

    // #when a frame is drawn in the ready state
    createOverlayRenderer(THEME).draw(readyFrame.ctx, ready, 0.016);

    // #then the guide is on screen, in the empty band below the grass
    const guide = readyFrame.texts.find((call) => call.text.includes("Space"));
    expect(guide?.text).toBe("クリック / Space で発射");
    expect(guide?.y).toBeGreaterThan(ITEM_CONFIG.canvasHeight / 2);

    // #and once the ball is in flight it is gone — it would only sit in
    // front of the board the player is now aiming at
    const playing = new Game(grid, ITEM_CONFIG);
    playing.launch();
    playing.update(0.016);
    expect(playing.state).toBe("playing");
    const playingFrame = makeFakeContext();
    createOverlayRenderer(THEME).draw(playingFrame.ctx, playing, 0.016);
    expect(playingFrame.texts.some((call) => call.text.includes("Space"))).toBe(false);
  });

  it("keeps both HUD labels inside the board", () => {
    // #given a game in play
    const game = playUntil(0, (g) => g.score > 0);
    const fake = makeFakeContext();

    // #when a frame is drawn
    createOverlayRenderer(THEME).draw(fake.ctx, game, 0.016);

    // #then no plate spills off either edge or the bottom of the canvas
    const plates = fake.fillRects.filter((call) => call.fillStyle === PAGE_BACKGROUND);
    expect(plates).toHaveLength(2);
    for (const plate of plates) {
      expect(plate.x).toBeGreaterThanOrEqual(0);
      expect(plate.x + plate.width).toBeLessThanOrEqual(game.config.canvasWidth);
      expect(plate.y + plate.height).toBeLessThanOrEqual(game.config.canvasHeight);
    }
  });
});
