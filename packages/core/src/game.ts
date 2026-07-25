import { isItemCaught, isItemOffScreen, moveItem } from "./items";
import type { Item, ItemKind } from "./items";
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
  /**
   * Probability (0..1) that destroying a brick drops an item, once the
   * board is fully cleared out — the floor of the ramp below.
   */
  itemDropChance: number;
  /**
   * Extra drop chance on top of `itemDropChance`, at full board, easing
   * linearly to 0 as bricks are destroyed. The opening is where a lone ball
   * has the least help and the least momentum, so drops are front-loaded:
   * with the defaults it starts at 22% and settles back to 8%. By the time
   * it thins out, the balls the player caught early are doing the work.
   */
  earlyItemDropBonus: number;
  /** Falling speed of a dropped item, in px/sec. */
  itemFallSpeed: number;
  /** Side length of the square item sprite, in px. */
  itemSize: number;
  /**
   * How many balls each ball in play becomes when a `multiBall` item is
   * caught. Splitting *every* ball (rather than adding a fixed number) is
   * what lets the count compound: on a year of dense grass, a handful of
   * catches is the difference between never finishing and clearing it.
   */
  multiBallSplitFactor: number;
  /**
   * Hard cap on how many balls can be in play at once — a backstop, not a
   * balance knob. Measured cost of `update()` on a 371-brick board:
   * 1 ball 0.02ms, 25 balls 0.29ms, 121 balls 0.49ms per frame against a
   * 16.7ms budget, so this is set far above what play actually reaches.
   */
  maxBalls: number;
  /** How long one `extraPaddle` item keeps the side bars, in seconds. */
  extraPaddleDurationSec: number;
  /** Width of each side bar as a fraction of the main paddle's width. */
  extraPaddleWidthRatio: number;
  /**
   * Source of randomness for item drops, in [0, 1). Injected rather than
   * calling `Math.random` directly so tests can script exactly which brick
   * drops what — the engine stays deterministic given a deterministic
   * source.
   */
  random: () => number;
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
  itemDropChance: 0.08,
  earlyItemDropBonus: 0.14,
  itemFallSpeed: 120,
  itemSize: 14,
  multiBallSplitFactor: 3,
  maxBalls: 200,
  extraPaddleDurationSec: 12,
  extraPaddleWidthRatio: 0.5,
  random: Math.random,
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

/**
 * Angle, in degrees, between a `multiBall` clone and the ball it was split
 * from. Clones alternate sides (-1st, +1st, -2nd, ...) so the fan stays
 * symmetric around the original trajectory.
 */
const MULTI_BALL_SPREAD_DEG = 22;

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
 * through the getters and the `onBrickHit` / `onStateChange` /
 * `onItemCollected` callbacks.
 */
export class Game {
  private readonly _config: GameConfig;
  private readonly cols: number;
  private readonly _layout: BrickLayout;
  private readonly bricks: Brick[];
  private readonly maxSubstepDt: number;
  private paddle: Paddle;
  /**
   * Every ball in play. Never empty: the moment the last one falls out of
   * the canvas a life is lost and a fresh ball is put back on the paddle,
   * so `ballState` always has something to return.
   */
  private balls: Ball[];
  private items: Item[] = [];
  /** Bricks destroyed so far — drives the drop-chance ramp. */
  private destroyedCount = 0;
  /** Seconds of `extraPaddle` left; the side bars exist while this is > 0. */
  private extraPaddleRemainingSec = 0;
  private _state: GameState = "ready";
  private _life: number;
  private _score = 0;
  private _combo = 0;

  onBrickHit?: (brick: Brick) => void;
  onStateChange?: (state: GameState) => void;
  /** Fired when a falling item is caught, after its effect has been applied. */
  onItemCollected?: (item: Item) => void;

  constructor(grid: ContributionGrid, config: Partial<GameConfig> = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._life = this._config.lives;
    this.cols = grid.weeks.length;
    this._layout = computeLayout(this._config, this.cols);
    this.bricks = this.buildBricks(grid);
    this.paddle = this.initialPaddle();
    this.balls = [this.ballOnPaddle()];
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

  /**
   * The primary ball. Kept for hosts (and the autopilot) that only care
   * about one — `ballStates` is what a renderer should draw.
   */
  get ballState(): Readonly<Ball> {
    return this.balls[0];
  }

  /** Every ball in play — one normally, more while `multiBall` is active. */
  get ballStates(): readonly Ball[] {
    return this.balls;
  }

  /** The main paddle, the one the pointer actually drives. */
  get paddleState(): Readonly<Paddle> {
    return this.paddle;
  }

  /** The main paddle plus the `extraPaddle` side bars while they last. */
  get paddleStates(): readonly Paddle[] {
    return this.activePaddles();
  }

  /** Items currently falling towards the paddle. */
  get itemStates(): readonly Item[] {
    return this.items;
  }

  /** Seconds of `extraPaddle` left, or 0 when the side bars are not out. */
  get extraPaddleRemaining(): number {
    return this.extraPaddleRemainingSec;
  }

  /** Moves the paddle so its centre is at `x`, clamped to the canvas. */
  movePaddle(x: number): void {
    const half = this.paddle.width / 2;
    const centerX = clamp(x, half, this._config.canvasWidth - half);
    this.paddle = { ...this.paddle, x: centerX - half };

    if (this._state === "ready" || this._state === "ballLost") {
      this.balls = [this.ballOnPaddle()];
    }
  }

  /** Launches the ball straight up from the paddle. No-op unless waiting. */
  launch(): void {
    if (this._state !== "ready" && this._state !== "ballLost") {
      return;
    }
    this.balls = [{ ...this.ballOnPaddle(), vy: -this._config.ballSpeed }];
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

  /**
   * Resolves one substep: every ball moves and resolves at most one brick
   * collision, then the falling items move. A life is only lost once the
   * *last* ball has left the canvas.
   */
  private stepPhysics(dt: number): void {
    const paddles = this.activePaddles();
    const survivors: Ball[] = [];

    for (const current of this.balls) {
      const ball = this.stepBall(current, dt, paddles);
      // Balls that fell past the bottom simply don't survive this substep.
      if (ball.y - ball.radius > this._config.canvasHeight) continue;
      survivors.push(ball);
    }
    this.balls = survivors;

    if (survivors.length === 0) {
      this.handleBallLost();
      return;
    }

    this.updateItems(dt, paddles);
    this.extraPaddleRemainingSec = Math.max(this.extraPaddleRemainingSec - dt, 0);

    if (this.bricks.every((brick) => !brick.alive)) {
      // The loop stops here, so anything still in the air would hang frozen
      // over the result screen (and in the shared result image).
      this.items = [];
      this.setState("clear");
    }
  }

  /** Moves one ball and resolves its wall / paddle / brick collisions. */
  private stepBall(current: Ball, dt: number, paddles: readonly Paddle[]): Ball {
    let ball = moveBall(current, dt);
    ball = reflectOffWalls(ball, {
      width: this._config.canvasWidth,
      height: this._config.canvasHeight,
    });

    // Any overlap with a paddle while descending counts as a catch —
    // not just a "top" reading. `detectBrickCollision`'s minimum-overlap
    // heuristic reports "left"/"right" for a corner hit against the thin
    // paddle rect, and requiring "top" specifically let those corner hits
    // fall straight through uncaught. Brick collisions are unaffected:
    // their side classification still drives which velocity axis flips.
    if (ball.vy > 0) {
      for (const paddle of paddles) {
        if (detectBrickCollision(ball, paddle) === null) continue;
        ball = reflectOffPaddle(ball, paddle, this._config.ballSpeed, this._config.maxBounceAngleDeg);
        this._combo = 0;
        break;
      }
    }

    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const side = detectBrickCollision(ball, brick.rect);
      if (!side) continue;

      ball = reflectOffBrick(ball, side);
      brick.level -= 1;

      if (brick.level <= 0) {
        brick.alive = false;
        this.destroyedCount += 1;
        const multiplier = 1 + this._combo * this._config.comboMultiplierStep;
        this._score += Math.round(brick.count * multiplier);
        this._combo += 1;
        this.maybeDropItem(brick);
      }

      this.onBrickHit?.(brick);
      break;
    }

    return ball;
  }

  /**
   * The colliders the ball can bounce off: the paddle, plus one side bar on
   * each side while `extraPaddle` is active.
   *
   * The bars sit one ball *radius* away from the paddle. That gap is what
   * makes them read as separate bars rather than a wider paddle, and
   * keeping it below the ball's diameter is what stops the ball slipping
   * between them — at exactly one radius, a ball centred on the gap still
   * overlaps both neighbours.
   */
  private activePaddles(): Paddle[] {
    if (this.extraPaddleRemainingSec <= 0) {
      return [this.paddle];
    }

    const width = this.paddle.width * this._config.extraPaddleWidthRatio;
    const gap = this._config.ballRadius;

    return [
      this.paddle,
      { ...this.paddle, x: this.paddle.x - gap - width, width },
      { ...this.paddle, x: this.paddle.x + this.paddle.width + gap, width },
    ];
  }

  /**
   * Rolls the drop chance for a brick that was just destroyed. The chance
   * ramps down with how much of the board is already gone — see
   * `earlyItemDropBonus`.
   */
  private maybeDropItem(brick: Brick): void {
    const { itemDropChance, earlyItemDropBonus, random, itemSize, itemFallSpeed } = this._config;
    const remainingRatio = this.bricks.length === 0 ? 0 : 1 - this.destroyedCount / this.bricks.length;
    if (random() >= itemDropChance + earlyItemDropBonus * remainingRatio) return;

    const kind: ItemKind = random() < 0.5 ? "multiBall" : "extraPaddle";
    this.items.push({
      kind,
      x: brick.rect.x + brick.rect.width / 2,
      y: brick.rect.y + brick.rect.height / 2,
      size: itemSize,
      vy: itemFallSpeed,
    });
  }

  /** Drops the items one substep, applying (and dropping) the caught ones. */
  private updateItems(dt: number, paddles: readonly Paddle[]): void {
    if (this.items.length === 0) return;

    const falling: Item[] = [];
    for (const current of this.items) {
      const item = moveItem(current, dt);

      if (paddles.some((paddle) => isItemCaught(item, paddle))) {
        this.applyItem(item);
        this.onItemCollected?.(item);
        continue;
      }
      if (isItemOffScreen(item, this._config.canvasHeight)) continue;

      falling.push(item);
    }
    this.items = falling;
  }

  private applyItem(item: Item): void {
    if (item.kind === "multiBall") {
      this.splitBalls();
      return;
    }
    // Re-catching refreshes the full duration rather than stacking it, so
    // the bars can't be banked into a permanent upgrade.
    this.extraPaddleRemainingSec = this._config.extraPaddleDurationSec;
  }

  /**
   * Splits *every* ball in play into `multiBallSplitFactor`, fanning the
   * clones out to alternating sides of the ball they came from so the
   * spread stays symmetric. Clones keep the configured speed — only the
   * direction differs. Compounding this way is deliberate: catching two
   * items should be worth far more than catching one.
   */
  private splitBalls(): void {
    const spreadRad = MULTI_BALL_SPREAD_DEG * (Math.PI / 180);
    const clones: Ball[] = [];

    for (const source of this.balls) {
      const baseAngle = Math.atan2(source.vy, source.vx);
      for (let i = 1; i < this._config.multiBallSplitFactor; i++) {
        if (this.balls.length + clones.length >= this._config.maxBalls) {
          this.balls.push(...clones);
          return;
        }
        const sign = i % 2 === 0 ? 1 : -1;
        const angle = baseAngle + sign * Math.ceil(i / 2) * spreadRad;
        clones.push({
          ...source,
          vx: Math.cos(angle) * this._config.ballSpeed,
          vy: Math.sin(angle) * this._config.ballSpeed,
        });
      }
    }

    this.balls.push(...clones);
  }

  private handleBallLost(): void {
    this._life -= 1;
    this._combo = 0;
    // Power-ups don't survive a lost ball: the next one starts clean.
    this.items = [];
    this.extraPaddleRemainingSec = 0;
    this.balls = [this.ballOnPaddle()];
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
