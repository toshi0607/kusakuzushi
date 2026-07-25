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
  /**
   * Exact brick height in px, for hosts that must land on real DOM cells
   * (the extension overlays github.com's own `td`s, and measures their
   * width and height separately — they are not guaranteed to agree).
   * Unset means "square": the brick's height follows its width.
   */
  brickHeightPx?: number;
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
  // 8:3。53 週ぶんの正方セル(一辺 ≈14px)は帯の高さ ≈134px にしかならないので、
  // 2:1 のままだと盤面の 2/3 が空洞になる。360 は草下端からパドルまでの
  // ボール往復距離を従来(204px)とほぼ同じ 190px に保つ高さ — 見た目だけを
  // 直し、ゲーム感は変えない(DESIGN.md §3)。
  canvasHeight: 360,
  // github.com のセルは 10px + 3px 間隔 = ストライドの 23% が隙間。ここも
  // 合わせないと、正方形でも「一枚の緑の板」に見えて日が数えられない。
  // 4px は 960/53 列で 14.04px セルになり、隙間比 22% で本家と一致する。
  brickGapPx: 4,
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
 * where things are.
 *
 * Bricks are square: a contribution cell is square on github.com, so the
 * board only reads as a contribution graph when its cells do too — the
 * brick's side is its width, derived from the canvas width and the column
 * count (DESIGN.md §3, "草の実寸比").
 *
 * The height that half the canvas could afford stays as an upper bound, so
 * the grass can never grow into the paddle's half no matter what canvas a
 * host hands us — on a canvas too narrow for square cells to fit, bricks
 * flatten instead of overflowing.
 *
 * `brickHeightPx` overrides both: a host drawing over real DOM cells owns
 * the true height and must not be second-guessed by this module's ideal.
 */
export function computeLayout(config: GameConfig, cols: number): BrickLayout {
  const safeCols = Math.max(cols, 1);
  const gap = config.brickGapPx;

  const brickAreaTop = gap;
  const halfCanvasBrickHeight = (config.canvasHeight / 2 - brickAreaTop - gap * (ROWS + 1)) / ROWS;
  const brickWidth = Math.max((config.canvasWidth - gap * (safeCols + 1)) / safeCols, 0);
  const brickHeight = Math.max(config.brickHeightPx ?? Math.min(brickWidth, halfCanvasBrickHeight), 0);
  const brickAreaHeight = brickHeight * ROWS + gap * (ROWS + 1);
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
  private readonly _layout: BrickLayout;
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
    this._layout = computeLayout(this._config, this.cols);
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

  /**
   * The pixel geometry this game was built with. Renderers read it instead
   * of re-deriving the grass band from `canvasHeight` — the band's height
   * follows the square cells, not a fixed fraction of the canvas.
   */
  get layout(): Readonly<BrickLayout> {
    return this._layout;
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
      y: this._layout.paddleY,
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
            x: gap + col * (this._layout.brickWidth + gap),
            y: this._layout.brickAreaTop + row * (this._layout.brickHeight + gap),
            width: this._layout.brickWidth,
            height: this._layout.brickHeight,
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
    if (this._layout.brickHeight > 0) {
      dimensions.push(this._layout.brickHeight);
    }
    const minDimension = Math.min(...dimensions);

    if (!Number.isFinite(minDimension) || minDimension <= 0 || this._config.ballSpeed <= 0) {
      return MAX_FRAME_DT;
    }

    return Math.min((minDimension * SUBSTEP_SAFETY_FACTOR) / this._config.ballSpeed, MAX_FRAME_DT);
  }
}
