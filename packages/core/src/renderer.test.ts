import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, Game } from "./game";
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
type ArcCall = { fillStyle: string; x: number; y: number; radius: number };

type FakeContext = {
  ctx: CanvasRenderingContext2D;
  fillRects: FillRectCall[];
  roundRects: RoundRectCall[];
  fillTexts: FillTextCall[];
  arcs: ArcCall[];
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
  const arcs: ArcCall[] = [];
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
    arc(x: number, y: number, radius: number): void {
      arcs.push({ fillStyle: String(this.fillStyle), x, y, radius });
    },
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
  return { ctx: stub as unknown as CanvasRenderingContext2D, fillRects, roundRects, fillTexts, arcs };
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

  it("draws one spare ball per remaining life, in the accent colour and clear of the grass", () => {
    // #given a fresh game (3 lives) with a single low-level brick
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]));
    const theme = { ...LIGHT_THEME, accentColor: "#ffb224" };
    const fake = makeFakeContext();

    // #when a frame renders
    render(fake.ctx, game, theme);

    // #then three accent-coloured circles sit on the HUD row below the grass
    // (grass occupies the top half, so anything above canvasHeight/2 would be buried in it)
    const hudRowY = DEFAULT_CONFIG.canvasHeight / 2 + 18;
    const spares = fake.arcs.filter((call) => call.y === hudRowY);
    expect(spares).toHaveLength(3);
    for (const spare of spares) {
      expect(spare.fillStyle).toBe("#ffb224");
      expect(spare.radius).toBe(DEFAULT_CONFIG.ballRadius);
    }
  });

  it("labels both HUD halves so the spare balls read as lives", () => {
    // #given a fresh game
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]));
    const fake = makeFakeContext();

    // #when a frame renders
    render(fake.ctx, game, LIGHT_THEME);

    // #then the HUD carries a score readout and a LIFE label
    expect(fake.fillTexts.map((call) => call.text)).toEqual(["SCORE 0", "LIFE"]);
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

  it("hides bricks at reveal 0 and draws them full-size at reveal 1", () => {
    // #given a game with one brick
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 2]));

    // #when rendering at reveal 0
    const hidden = makeFakeContext();
    render(hidden.ctx, game, LIGHT_THEME, { reveal: 0 });

    // #then no brick rect is drawn
    expect(hidden.fillRects.filter((call) => call.fillStyle === LIGHT_THEME.colors[2])).toHaveLength(0);

    // #when rendering at reveal 1 (and with options omitted)
    const shown = makeFakeContext();
    render(shown.ctx, game, LIGHT_THEME, { reveal: 1 });
    const plain = makeFakeContext();
    render(plain.ctx, game, LIGHT_THEME);

    // #then the brick appears at its exact rect in both
    const brick = game.liveBricks[0];
    for (const fake of [shown, plain]) {
      const call = fake.fillRects.find((c) => c.fillStyle === LIGHT_THEME.colors[2]);
      expect(call).toMatchObject({ x: brick.rect.x, y: brick.rect.y, width: brick.rect.width, height: brick.rect.height });
    }
  });

  it("skips the HUD when options.hud is false", () => {
    // #given a fresh game
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]));
    const fake = makeFakeContext();

    // #when rendering with hud: false
    render(fake.ctx, game, LIGHT_THEME, { hud: false });

    // #then neither the score text nor the spare balls are drawn
    // (the single remaining arc is the ball in play)
    expect(fake.fillTexts).toHaveLength(0);
    const spares = fake.arcs.filter((call) => call.y === DEFAULT_CONFIG.canvasHeight / 2 + 18);
    expect(spares).toHaveLength(0);
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
