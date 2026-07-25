import { MAX_FRAME_DT } from "./game";
import type { Brick, Game } from "./game";

/**
 * GitHub's 5-step green scale, index 0..4 matching `Cell.level` /
 * `Brick.level`. index 0 doubles as the empty-grass / canvas background
 * colour.
 */
export type Theme = {
  colors: readonly [string, string, string, string, string];
  paddleColor: string;
  ballColor: string;
  textColor: string;
  particleColor?: string;
  /** Ball (and future highlight) colour. Falls back to `ballColor`. */
  accentColor?: string;
  /** CSS font-family list for the HUD text. Falls back to `sans-serif`. */
  hudFont?: string;
};

export const LIGHT_THEME: Theme = {
  colors: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  paddleColor: "#24292f",
  ballColor: "#24292f",
  textColor: "#24292f",
};

export const DARK_THEME: Theme = {
  colors: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  paddleColor: "#c9d1d9",
  ballColor: "#c9d1d9",
  textColor: "#c9d1d9",
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type RendererState = {
  destroyedKeys: Set<string>;
  /** Level each brick last had while alive — the colour its particles keep. */
  lastAliveLevels: Map<string, number>;
  particles: Particle[];
  lastTimeMs: number;
};

const rendererStates = new WeakMap<Game, RendererState>();

function brickKey(brick: Brick): string {
  return `${brick.row}:${brick.col}`;
}

/**
 * `roundRect` is missing from older canvas implementations and from the
 * plain-object stubs used in tests, so fall back to a sharp rect there.
 */
function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, width, height);
  }
}

function spawnParticles(particles: Particle[], brick: Brick, theme: Theme, level: number): void {
  const cx = brick.rect.x + brick.rect.width / 2;
  const cy = brick.rect.y + brick.rect.height / 2;
  const color = theme.particleColor ?? theme.colors[Math.min(Math.max(level, 1), 4)];
  const count = 6;

  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 40 + Math.random() * 60;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5,
      maxLife: 0.5,
      size: 2 + Math.random() * 2,
      color,
    });
  }
}

function updateParticles(particles: Particle[], dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function getState(game: Game): RendererState {
  let state = rendererStates.get(game);
  if (!state) {
    state = { destroyedKeys: new Set(), lastAliveLevels: new Map(), particles: [], lastTimeMs: Date.now() };
    rendererStates.set(game, state);
  }
  return state;
}

export type RenderOptions = {
  /**
   * 0..1 の「草の生育」進行度。列が左(古い週)から右へ順にスケールインする。
   * 省略時は 1(全表示)。1 未満の間もゲーム進行には影響しない(描画のみ)。
   */
  reveal?: number;
  /** false でスコア・残機の HUD を描かない(デモプレイ用)。省略時は true。 */
  hud?: boolean;
};

/** Column `col` of `cols` grows within its own slice of the reveal timeline. */
function revealScaleFor(reveal: number, col: number, cols: number): number {
  const start = cols <= 1 ? 0 : (col / cols) * 0.7;
  const t = Math.min(Math.max((reveal - start) / 0.3, 0), 1);
  return 1 - (1 - t) * (1 - t);
}

/**
 * Draws one frame of `game` into `ctx`. `ctx` and the canvas it belongs to
 * are supplied by the caller — this module never touches `document` /
 * `window` or any other DOM global, and calls no runtime Web API of its
 * own (particle timing uses `Date.now()`, not `performance.now()`).
 *
 * Safe to call every animation frame: per-Game particle/animation state is
 * tracked internally and keyed off the `Game` instance identity.
 */
export function render(ctx: CanvasRenderingContext2D, game: Game, theme: Theme = LIGHT_THEME, options?: RenderOptions): void {
  const config = game.config;
  const state = getState(game);

  const now = Date.now();
  const dt = Math.min(Math.max((now - state.lastTimeMs) / 1000, 0), MAX_FRAME_DT);
  state.lastTimeMs = now;

  for (const brick of game.liveBricks) {
    const key = brickKey(brick);
    if (brick.alive) {
      state.lastAliveLevels.set(key, brick.level);
    } else if (!state.destroyedKeys.has(key)) {
      state.destroyedKeys.add(key);
      spawnParticles(state.particles, brick, theme, state.lastAliveLevels.get(key) ?? brick.level);
    }
  }
  updateParticles(state.particles, dt);

  ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
  ctx.fillStyle = theme.colors[0];
  ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

  const reveal = Math.min(Math.max(options?.reveal ?? 1, 0), 1);
  let revealCols = 1;
  if (reveal < 1) {
    for (const brick of game.liveBricks) {
      if (brick.col + 1 > revealCols) revealCols = brick.col + 1;
    }
  }

  for (const brick of game.liveBricks) {
    if (!brick.alive) continue;
    const levelIndex = Math.min(Math.max(brick.level, 1), 4);
    ctx.fillStyle = theme.colors[levelIndex];
    const scale = reveal < 1 ? revealScaleFor(reveal, brick.col, revealCols) : 1;
    if (scale <= 0) continue;
    const width = brick.rect.width * scale;
    const height = brick.rect.height * scale;
    const x = brick.rect.x + (brick.rect.width - width) / 2;
    const y = brick.rect.y + (brick.rect.height - height) / 2;
    // GitHub の草セルと同じ比率(10px セルに 2px 角丸)で丸める
    const radius = Math.min(width, height) * 0.2;
    fillRoundRect(ctx, x, y, width, height, radius);
  }

  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(particle.life / particle.maxLife, 0);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;

  const paddle = game.paddleState;
  ctx.fillStyle = theme.paddleColor;
  fillRoundRect(ctx, paddle.x, paddle.y, paddle.width, paddle.height, paddle.height / 2);

  const ball = game.ballState;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = theme.accentColor ?? theme.ballColor;
  ctx.fill();

  if (options?.hud !== false) {
    ctx.fillStyle = theme.textColor;
    ctx.font = `16px ${theme.hudFont ?? "sans-serif"}`;
    ctx.textBaseline = "top";
    ctx.fillText(`SCORE ${game.score}`, 8, 8);

    // 残機は数字ではなく「草セル」を並べて示す
    const lifeCell = 10;
    const lifeGap = 4;
    ctx.fillStyle = theme.colors[4];
    for (let i = 0; i < game.life; i++) {
      const x = config.canvasWidth - 8 - lifeCell - i * (lifeCell + lifeGap);
      fillRoundRect(ctx, x, 8, lifeCell, lifeCell, 2);
    }
  }
}
