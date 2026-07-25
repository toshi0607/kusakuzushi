import { describe, expect, it } from "vitest";
import { Game } from "./game";
import type { GameConfig } from "./game";
import type { Cell, ContributionGrid } from "./model";

/** A single-column grid where `rowLevels[row]` sets that day's level directly. */
function makeGrid(rowLevels: Array<0 | 1 | 2 | 3 | 4>, counts: number[] = rowLevels.map(() => 10)): ContributionGrid {
  const week: Cell[] = rowLevels.map((level, row) => ({
    date: `2024-01-0${row + 1}`,
    count: counts[row],
    level,
  }));
  return { username: "octocat", weeks: [week], total: counts.reduce((a, b) => a + b, 0) };
}

/** Two columns: col0 is empty (never touched), col1 carries `col1RowLevels`. */
function makeTwoColumnGrid(col1RowLevels: Array<0 | 1 | 2 | 3 | 4>): ContributionGrid {
  const emptyWeek: Cell[] = Array.from({ length: 7 }, (_, row) => ({
    date: `2024-01-0${row + 1}`,
    count: 0,
    level: 0,
  }));
  const week1: Cell[] = col1RowLevels.map((level, row) => ({
    date: `2024-01-1${row + 1}`,
    count: 5,
    level,
  }));
  return { username: "octocat", weeks: [emptyWeek, week1], total: 5 * col1RowLevels.filter((l) => l > 0).length };
}

/** Base config: full-width paddle so the ball always returns to it (vx stays 0). */
const BASE_CONFIG: GameConfig = {
  canvasWidth: 100,
  canvasHeight: 200,
  brickGapPx: 0,
  paddleWidth: 100,
  paddleHeight: 10,
  paddleMarginBottom: 0,
  ballRadius: 5,
  ballSpeed: 100,
  maxBounceAngleDeg: 60,
  lives: 3,
  comboMultiplierStep: 0.5,
};

function stepUntil(game: Game, predicate: () => boolean, dt = 0.01, maxSteps = 5000): void {
  let steps = 0;
  while (!predicate() && steps < maxSteps) {
    game.update(dt);
    steps += 1;
  }
  if (!predicate()) {
    throw new Error(`stepUntil: predicate not satisfied after ${maxSteps} steps`);
  }
}

/** A full 53-week year on the default canvas — what the web app renders. */
function makeFullYearGrid(): ContributionGrid {
  const weeks: Cell[][] = Array.from({ length: 53 }, (_, col) =>
    Array.from({ length: 7 }, (_, row) => ({ date: `2024-w${col}-${row}`, count: 1, level: 1 as const })),
  );
  return { username: "octocat", weeks, total: 53 * 7 };
}

describe("brick geometry", () => {
  it("lays out square bricks, like the contribution cells they stand for", () => {
    // #given a full year on the default canvas
    const game = new Game(makeFullYearGrid());

    // #then every brick is as tall as it is wide
    expect(game.layout.brickHeight).toBeCloseTo(game.layout.brickWidth, 10);
    for (const brick of game.liveBricks) {
      expect(brick.rect.height).toBeCloseTo(brick.rect.width, 10);
    }
  });

  it("keeps the whole grass band clear of the paddle", () => {
    // #given the same full year
    const game = new Game(makeFullYearGrid());

    // #then the band ends well above the paddle, leaving the play space
    // the ball needs (DESIGN.md §3: grass on top, paddle space below)
    const grassBottom = game.layout.brickAreaTop + game.layout.brickAreaHeight;
    expect(grassBottom).toBeLessThan(game.layout.paddleY);
    const lowestBrick = Math.max(...game.liveBricks.map((brick) => brick.rect.y + brick.rect.height));
    expect(lowestBrick).toBeLessThanOrEqual(grassBottom);
  });

  it("flattens bricks rather than letting them grow into the paddle's half on a short canvas", () => {
    // #given a canvas so wide and short that square cells would not fit
    // above the paddle (a host could hand core any size)
    const game = new Game(makeGrid([1, 1, 1, 1, 1, 1, 1]), {
      ...BASE_CONFIG,
      canvasWidth: 1000,
      canvasHeight: 100,
    });

    // #then the bricks flatten instead, and the band stays in the top half
    expect(game.layout.brickHeight).toBeLessThan(game.layout.brickWidth);
    expect(game.layout.brickAreaTop + game.layout.brickAreaHeight).toBeLessThanOrEqual(
      game.config.canvasHeight / 2,
    );
  });
});

describe("Game", () => {
  it("starts in the ready state and only begins moving after launch()", () => {
    // #given
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1]), BASE_CONFIG);
    // #when
    game.update(1);
    // #then update() before launch() is a no-op
    expect(game.state).toBe("ready");
    expect(game.ballState.vy).toBe(0);
  });

  it("destroys a level-1 brick on the first hit, scores its count, and clears when it was the last brick", () => {
    // #given a single level-1 brick in the bottom row (closest to the paddle)
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 10]), BASE_CONFIG);
    let hits = 0;
    game.onBrickHit = () => {
      hits += 1;
    };
    // #when
    game.launch();
    stepUntil(game, () => hits >= 1);
    // #then
    expect(game.liveBricks[0].alive).toBe(false);
    expect(game.score).toBe(10);
    expect(game.combo).toBe(1);
    expect(game.state).toBe("clear");
  });

  it("decrements a multi-hit brick's level per hit without destroying it early", () => {
    // #given a level-4 brick (HP 4)
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 4], [0, 0, 0, 0, 0, 0, 10]), BASE_CONFIG);
    let hits = 0;
    game.onBrickHit = () => {
      hits += 1;
    };
    // #when: exactly one hit
    game.launch();
    stepUntil(game, () => hits >= 1);
    // #then: HP dropped by 1, brick still alive, no score/combo yet
    expect(game.liveBricks[0].level).toBe(3);
    expect(game.liveBricks[0].alive).toBe(true);
    expect(game.score).toBe(0);
    expect(game.combo).toBe(0);
    expect(game.state).toBe("playing");

    // #when: three more hits (4 total) destroy it
    stepUntil(game, () => hits >= 4);
    // #then
    expect(game.liveBricks[0].alive).toBe(false);
    expect(game.liveBricks[0].level).toBe(0);
    expect(game.score).toBe(10);
    expect(game.state).toBe("clear");
  });

  it("resets the combo multiplier when the ball touches the paddle between two brick destructions", () => {
    // #given two level-1 bricks stacked in the same column; row6 (count 10) is
    // hit first, then the ball must bounce off the full-width paddle before
    // it can reach row5 (count 20).
    const game = new Game(
      makeGrid([0, 0, 0, 0, 0, 1, 1], [0, 0, 0, 0, 0, 20, 10]),
      BASE_CONFIG,
    );
    let hits = 0;
    game.onBrickHit = () => {
      hits += 1;
    };
    // #when
    game.launch();
    stepUntil(game, () => hits >= 1);
    // #then first destroy uses multiplier 1 (combo was 0)
    expect(game.score).toBe(10);
    expect(game.combo).toBe(1);

    // #when the ball bounces off the paddle and destroys the second brick
    stepUntil(game, () => hits >= 2);
    // #then if the paddle touch had NOT reset combo, this would be 10 + 30 = 40
    expect(game.score).toBe(30);
    expect(game.combo).toBe(1);
    expect(game.state).toBe("clear");
  });

  it("loses a life and enters ballLost when the ball falls past the paddle, then gameOver once lives run out", () => {
    // #given a narrow paddle and one brick far out of the ball's path so the
    // grid never vacuously "clears" while we drain all 3 lives
    const config: GameConfig = { ...BASE_CONFIG, paddleWidth: 20 };
    const game = new Game(makeTwoColumnGrid([1, 0, 0, 0, 0, 0, 0]), config);

    const missOnce = (expectedLife: number, expectedState: "ballLost" | "gameOver") => {
      game.movePaddle(20); // safe x, inside col0, far from the col1 brick
      game.launch();
      game.movePaddle(90); // move away so the paddle can't catch the ball on the way down
      stepUntil(game, () => game.state === expectedState);
      expect(game.life).toBe(expectedLife);
    };

    // #when / #then
    missOnce(2, "ballLost");
    missOnce(1, "ballLost");
    missOnce(0, "gameOver");
  });

  it("clamps the paddle position within the canvas", () => {
    // #given a narrow paddle
    const game = new Game(makeGrid([0, 0, 0, 0, 0, 0, 0]), { ...BASE_CONFIG, paddleWidth: 20 });
    // #when moving far past both edges
    game.movePaddle(-1000);
    expect(game.paddleState.x).toBe(0);
    game.movePaddle(1000);
    // #then clamped to canvasWidth - paddleWidth
    expect(game.paddleState.x).toBe(80);
  });

  it("[M1] still bounces off the paddle instead of tunnelling through it when dt is huge (e.g. a backgrounded tab resuming)", () => {
    // #given a full-width paddle and a ball speed high enough that a single
    // un-substepped step (even one clamped to MAX_FRAME_DT=0.1s) would cross
    // the entire 10px paddle many times over (2000px/s * 0.1s = 200px >> 10px).
    // A decoy brick in a column the ball's vx=0 trajectory never reaches keeps
    // the grid from vacuously "clearing" (0 bricks) while we probe this.
    const config: GameConfig = {
      ...BASE_CONFIG,
      canvasWidth: 200,
      canvasHeight: 250,
      paddleWidth: 30,
      ballSpeed: 2000,
    };
    const game = new Game(makeTwoColumnGrid([1, 0, 0, 0, 0, 0, 0]), config);
    game.movePaddle(30); // inside col0, comfortably away from col1's decoy brick
    game.launch();

    // #when driving several huge-dt frames: (1) ascends most of the way to
    // the top wall, (2) bounces off the top wall and descends partway back
    // down, (3)-(5) the ball is now well above the paddle and falling fast
    // — without the fix this is where it tunnels through the paddle and, a
    // couple of frames later, falls past the bottom of the canvas.
    for (let i = 0; i < 5; i++) {
      game.update(999);
    }

    // #then the paddle caught it every time: no life lost, still playing
    expect(game.life).toBe(3);
    expect(game.state).toBe("playing");
  });

  it("[M2] catches the ball off a corner hit on the paddle, not just a dead-centre \"top\" hit", () => {
    // #given a paddle bounce with an angle (bounce #1, off-centre) sends the
    // ball on a long diagonal that returns to paddle height far to the
    // right. Positioning the paddle so the ball's return path grazes its
    // right edge makes `detectBrickCollision` classify the hit as "right"
    // (not "top") — verified empirically: at this exact paddle position,
    // reverting the M2 fix (requiring `=== "top"`) makes the ball fall
    // straight through and lose a life instead of bouncing.
    const config: GameConfig = {
      ...BASE_CONFIG,
      canvasWidth: 500,
      paddleWidth: 20,
    };
    const game = new Game(makeTwoColumnGrid([1, 0, 0, 0, 0, 0, 0]), config);
    game.movePaddle(50);
    game.launch(); // straight up, vx=0

    game.movePaddle(45); // off-centre paddle for bounce #1 (creates the angle)

    let repositioned = false;
    let stopAtStep = -1;
    for (let step = 0; step < 100 && game.state === "playing"; step++) {
      game.update(0.1); // each call internally clamped to MAX_FRAME_DT
      if (!repositioned && game.ballState.vx !== 0) {
        // Bounce #1 just happened; reposition for the corner hit on approach #2
        // (safe: the ball is still ascending, far from the paddle's y).
        repositioned = true;
        game.movePaddle(246.5);
        stopAtStep = step + 45; // enough to cover the return trip, not a 3rd bounce
      }
      if (stopAtStep >= 0 && step >= stopAtStep) break;
    }

    // #then the corner hit was caught: no life lost, still playing
    expect(game.life).toBe(3);
    expect(game.state).toBe("playing");
  });
});
