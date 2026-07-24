import type { ContributionGrid } from "./model";
import {
  clamp,
  detectBrickCollision,
  moveBall,
  reflectOffBrick,
  reflectOffPaddle,
  reflectOffWalls,
} from "./physics";
import type { Ball, BrickRect, Paddle } from "./physics";

export type GameState = "ready" | "playing" | "ballLost" | "gameOver" | "clear";

export type GameConfig = {
  canvasWidth: number;
  canvasHeight: number;
  /** Gap, in px, drawn between adjacent bricks and around the brick field. */
  brickGapPx: number;
  paddleWidth: number;
  paddleHeight: number;
  /** Distance from the bottom of the canvas to the paddle. */
  paddleMarginBottom: number;
  ballRadius: number;
  /** Constant ball speed in px/sec — the ball never speeds up or slows down. */
  ballSpeed: number;
  /** Maximum paddle-bounce deflection from straight up, in degrees. */
  maxBounceAngleDeg: number;
  lives: number;
  /**
   * Score multiplier added per consecutive brick destroyed without the ball
   * touching the paddle: multiplier = 1 + combo * comboMultiplierStep.
   */
  comboMultiplierStep: number;
};

export const DEFAULT_CONFIG: GameConfig = {
  canvasWidth: 960,
  canvasHeight: 480,
  brickGapPx: 2,
  paddleWidth: 80,
  paddleHeight: 12,
  paddleMarginBottom: 24,
  ballRadius: 6,
  ballSpeed: 320,
  maxBounceAngleDeg: 60,
  lives: 3,
  comboMultiplierStep: 0.5,
};

/**
 * Upper bound, in seconds, on the simulated time a single `update(dt)` (or
 * `renderer.render`) call will advance by. Caps the substep work done for
 * a huge `dt` (e.g. a backgrounded browser tab resuming) and keeps
 * `Game.update` and `renderer.ts`'s particle-timing clamp in lockstep —
 * `renderer.ts` imports this same constant instead of hardcoding 0.1.
 */
export const MAX_FRAME_DT = 0.1;

/**
 * Safety factor applied to the smallest collider dimension when sizing
 * physics substeps: a substep may move the ball by at most half of the
 * thinnest paddle/brick, so a single `update(dt)` call can never let the
 * ball skip over a collider entirely (tunnelling) no matter how large
 * `dt` is.
 */
const SUBSTEP_SAFETY_FACTOR = 0.5;

/** Rows per week: Sunday (0) through Saturday (6), matching GitHub's grid. */
const ROWS = 7;

export type Brick = {
  row: number;
  col: number;
  rect: BrickRect;
  /**
   * Current HP, doubling as the display level (1-4). Starts at the cell's
   * GitHub contribution level and drops by 1 per hit; the brick is
   * destroyed when it reaches 0.
   */
  level: number;
  /** Original contribution count for this day — the brick's score value. */
  count: number;
  alive: boolean;
};

export type BrickLayout = {
  brickWidth: number;
  brickHeight: number;
  brickAreaTop: number;
  brickAreaHeight: number;
  paddleY: number;
};

/**
 * Computes the shared pixel geometry for the brick field and the paddle so
 * that `Game` (collision) and `renderer.ts` (drawing) never disagree about
 * where things are. The brick field is capped at half the canvas height so
 * the paddle always keeps at least as much space below it as the grass
 * occupies above (see DESIGN.md §3).
 */
export function computeLayout(config: GameConfig, cols: number): BrickLayout {
  const safeCols = Math.max(cols, 1);
  const gap = config.brickGapPx;

  const brickAreaTop = gap;
  const brickAreaHeight = Math.max(config.canvasHeight / 2 - brickAreaTop, 0);
  const brickWidth = Math.max((config.canvasWidth - gap * (safeCols + 1)) / safeCols, 0);
  const brickHeight = Math.max((brickAreaHeight - gap * (ROWS + 1)) / ROWS, 0);
  const paddleY = config.canvasHeight - config.paddleMarginBottom - config.paddleHeight;

  return { brickWidth, brickHeight, brickAreaTop, brickAreaHeight, paddleY };
}

/**
 * The game engine: owns ball/paddle/brick state and advances it frame by
 * frame. Pure TypeScript — no DOM, no fetch, no timers. The host (web app,
 * extension, or a test) drives it via `update(dt)` and reads state back
 * through the getters and the `onBrickHit` / `onStateChange` callbacks.
 */
export class Game {
  private readonly _config: GameConfig;
  private readonly cols: number;
  private readonly layout: BrickLayout;
  private readonly bricks: Brick[];
  private readonly maxSubstepDt: number;
  private paddle: Paddle;
  private ball: Ball;
  private _state: GameState = "ready";
  private _life: number;
  private _score = 0;
  private _combo = 0;

  onBrickHit?: (brick: Brick) => void;
  onStateChange?: (state: GameState) => void;

  constructor(grid: ContributionGrid, config: Partial<GameConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._life = this._config.lives;
    this.cols = grid.weeks.length;
    this.layout = computeLayout(this._config, this.cols);
    this.bricks = this.buildBricks(grid);
    this.paddle = this.initialPaddle();
    this.ball = this.ballOnPaddle();
    this.maxSubstepDt = this.computeMaxSubstepDt();
  }

  get config(): Readonly<GameConfig> {
    return this._config;
  }

  get state(): GameState {
    return this._state;
  }

  get life(): number {
    return this._life;
  }

  get score(): number {
    return this._score;
  }

  get combo(): number {
    return this._combo;
  }

  get liveBricks(): readonly Brick[] {
    return this.bricks;
  }

  get ballState(): Readonly<Ball> {
    return this.ball;
  }

  get paddleState(): Readonly<Paddle> {
    return this.paddle;
  }

  /** Moves the paddle so its centre is at `x`, clamped to the canvas. */
  movePaddle(x: number): void {
    const half = this.paddle.width / 2;
    const centerX = clamp(x, half, this._config.canvasWidth - half);
    this.paddle = { ...this.paddle, x: centerX - half };

    if (this._state === "ready" || this._state === "ballLost") {
      this.ball = this.ballOnPaddle();
    }
  }

  /** Launches the ball straight up from the paddle. No-op unless waiting. */
  launch(): void {
    if (this._state !== "ready" && this._state !== "ballLost") {
      return;
    }
    this.ball = { ...this.ballOnPaddle(), vy: -this._config.ballSpeed };
    this.setState("playing");
  }

  /**
   * Advances the simulation by `dt` seconds. No-op unless `playing`.
   *
   * `dt` is clamped to `MAX_FRAME_DT` and then integrated in substeps no
   * larger than `maxSubstepDt`, so a huge `dt` (a backgrounded tab
   * resuming, a slow test-harness tick, ...) can never let the ball cross
   * an entire paddle or brick row within a single collision check —
   * without this, `speed * dt` could exceed the collider's thickness and
   * the ball would tunnel straight through it.
   */
  update(dt: number): void {
    if (this._state !== "playing") {
      return;
    }

    let remaining = clamp(dt, 0, MAX_FRAME_DT);
    while (remaining > 0 && this._state === "playing") {
      const step = Math.min(this.maxSubstepDt, remaining);
      this.stepPhysics(step);
      remaining -= step;
    }
  }

  /** Resolves ball movement and at most one collision for a single substep. */
  private stepPhysics(dt: number): void {
    let ball = moveBall(this.ball, dt);
    ball = reflectOffWalls(ball, {
      width: this._config.canvasWidth,
      height: this._config.canvasHeight,
    });

    // Any overlap with the paddle while descending counts as a catch —
    // not just a "top" reading. `detectBrickCollision`'s minimum-overlap
    // heuristic reports "left"/"right" for a corner hit against the thin
    // paddle rect, and requiring "top" specifically let those corner hits
    // fall straight through uncaught. Brick collisions are unaffected:
    // their side classification still drives which velocity axis flips.
    if (ball.vy > 0 && detectBrickCollision(ball, this.paddle) !== null) {
      ball = reflectOffPaddle(ball, this.paddle, this._config.ballSpeed, this._config.maxBounceAngleDeg);
      this._combo = 0;
    }

    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const side = detectBrickCollision(ball, brick.rect);
      if (!side) continue;

      ball = reflectOffBrick(ball, side);
      brick.level -= 1;

      if (brick.level <= 0) {
        brick.alive = false;
        const multiplier = 1 + this._combo * this._config.comboMultiplierStep;
        this._score += Math.round(brick.count * multiplier);
        this._combo += 1;
      }

      this.onBrickHit?.(brick);
      break;
    }

    this.ball = ball;

    if (ball.y - ball.radius > this._config.canvasHeight) {
      this.handleBallLost();
      return;
    }

    if (this.bricks.every((brick) => !brick.alive)) {
      this.setState("clear");
    }
  }

  private handleBallLost(): void {
    this._life -= 1;
    this._combo = 0;
    this.ball = this.ballOnPaddle();
    this.setState(this._life <= 0 ? "gameOver" : "ballLost");
  }

  private setState(state: GameState): void {
    if (this._state === state) return;
    this._state = state;
    this.onStateChange?.(state);
  }

  private initialPaddle(): Paddle {
    return {
      x: (this._config.canvasWidth - this._config.paddleWidth) / 2,
      y: this.layout.paddleY,
      width: this._config.paddleWidth,
      height: this._config.paddleHeight,
    };
  }

  private ballOnPaddle(): Ball {
    return {
      x: this.paddle.x + this.paddle.width / 2,
      y: this.paddle.y - this._config.ballRadius,
      vx: 0,
      vy: 0,
      radius: this._config.ballRadius,
    };
  }

  private buildBricks(grid: ContributionGrid): Brick[] {
    const gap = this._config.brickGapPx;
    const bricks: Brick[] = [];

    for (let col = 0; col < this.cols; col++) {
      const week = grid.weeks[col];
      for (let row = 0; row < week.length; row++) {
        const cell = week[row];
        if (cell.level < 1) continue;

        bricks.push({
          row,
          col,
          rect: {
            x: gap + col * (this.layout.brickWidth + gap),
            y: this.layout.brickAreaTop + row * (this.layout.brickHeight + gap),
            width: this.layout.brickWidth,
            height: this.layout.brickHeight,
          },
          level: cell.level,
          count: cell.count,
          alive: true,
        });
      }
    }

    return bricks;
  }

  /**
   * Largest substep, in seconds, such that `ballSpeed * dt` cannot exceed
   * half the thinnest collider (paddle height, or brick height if smaller)
   * — see `SUBSTEP_SAFETY_FACTOR`. Falls back to `MAX_FRAME_DT` when there
   * is no meaningful collider dimension (e.g. an empty grid).
   */
  private computeMaxSubstepDt(): number {
    const dimensions = [this._config.paddleHeight];
    if (this.layout.brickHeight > 0) {
      dimensions.push(this.layout.brickHeight);
    }
    const minDimension = Math.min(...dimensions);

    if (!Number.isFinite(minDimension) || minDimension <= 0 || this._config.ballSpeed <= 0) {
      return MAX_FRAME_DT;
    }

    return Math.min((minDimension * SUBSTEP_SAFETY_FACTOR) / this._config.ballSpeed, MAX_FRAME_DT);
  }
}
