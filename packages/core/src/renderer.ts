import { MAX_FRAME_DT } from "./game";
import type { Brick, Game } from "./game";
import type { Item } from "./items";

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
  /**
   * Falling item colour. Deliberately not the ball's accent: an item and a
   * ball are both small amber-ish sprites in flight, and at a glance the
   * player has to be able to tell "chase this" from "dodge nothing".
   * Falls back to `accentColor`, then `ballColor`.
   */
  itemColor?: string;
  /** CSS font-family list for the HUD text. Falls back to `sans-serif`. */
  hudFont?: string;
};

/** GitHub's own accent blue, per colour scheme — the one hue that is neither grass nor ball. */
const LIGHT_ITEM_COLOR = "#0969da";
const DARK_ITEM_COLOR = "#58a6ff";

export const LIGHT_THEME: Theme = {
  colors: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  paddleColor: "#24292f",
  ballColor: "#24292f",
  textColor: "#24292f",
  itemColor: LIGHT_ITEM_COLOR,
};

export const DARK_THEME: Theme = {
  colors: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  paddleColor: "#c9d1d9",
  ballColor: "#c9d1d9",
  textColor: "#c9d1d9",
  itemColor: DARK_ITEM_COLOR,
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

/**
 * Item glyph geometry, as fractions of the item's side length. The marks
 * are knocked out of the tile in the background colour and drawn with
 * `fillRect` only, which keeps them legible at the ~10px items the
 * extension's board uses and matches the pixel-type look of the HUD.
 *
 * `multiBall` is three dots in a triangle (one ball became several);
 * `extraPaddle` is three bars in a row — literally what the player gets.
 */
const ITEM_CORNER_RADIUS_RATIO = 0.25;
const ITEM_DOT_SIZE_RATIO = 0.2;
const ITEM_DOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0.4, 0.15],
  [0.17, 0.55],
  [0.63, 0.55],
];
const ITEM_BAR_WIDTH_RATIO = 0.18;
const ITEM_BAR_HEIGHT_RATIO = 0.3;
const ITEM_BAR_TOP_RATIO = 0.35;
const ITEM_BAR_LEFT_RATIOS: readonly number[] = [0.13, 0.41, 0.69];

function drawItem(ctx: CanvasRenderingContext2D, item: Item, theme: Theme): void {
  const size = item.size;
  const left = item.x - size / 2;
  const top = item.y - size / 2;

  ctx.fillStyle = theme.itemColor ?? theme.accentColor ?? theme.ballColor;
  fillRoundRect(ctx, left, top, size, size, size * ITEM_CORNER_RADIUS_RATIO);

  ctx.fillStyle = theme.colors[0];
  if (item.kind === "multiBall") {
    const dot = size * ITEM_DOT_SIZE_RATIO;
    for (const [dx, dy] of ITEM_DOT_OFFSETS) {
      ctx.fillRect(left + size * dx, top + size * dy, dot, dot);
    }
    return;
  }

  const barWidth = size * ITEM_BAR_WIDTH_RATIO;
  const barHeight = size * ITEM_BAR_HEIGHT_RATIO;
  for (const dx of ITEM_BAR_LEFT_RATIOS) {
    ctx.fillRect(left + size * dx, top + size * ITEM_BAR_TOP_RATIO, barWidth, barHeight);
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

  for (const item of game.itemStates) {
    drawItem(ctx, item, theme);
  }

  // Every paddle, not just the main one: `extraPaddle` puts a side bar on
  // each side of it for a while.
  ctx.fillStyle = theme.paddleColor;
  for (const paddle of game.paddleStates) {
    fillRoundRect(ctx, paddle.x, paddle.y, paddle.width, paddle.height, paddle.height / 2);
  }

  ctx.fillStyle = theme.accentColor ?? theme.ballColor;
  for (const ball of game.ballStates) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (options?.hud !== false) {
    // HUD は草の上に重ねない。草の直下(盤面の下半分の先頭)に置くことで、
    // ブロックを隠さず、背景の無地の上で確実に読める。
    const hudTop = config.canvasHeight / 2 + 10;

    ctx.fillStyle = theme.textColor;
    ctx.font = `16px ${theme.hudFont ?? "sans-serif"}`;
    ctx.textBaseline = "top";
    ctx.fillText(`SCORE ${game.score}`, 8, hudTop);

    // 残機は「予備のボール」。実際のボールと同じ色・同じ大きさで並べる
    // (草と同じ緑で描くと草に埋もれて見えない、という指摘への対応)。
    // 左の SCORE と対になるよう LIFE ラベルを添えて、初見でも意味が分かるようにする。
    if (game.life > 0) {
      const spareRadius = config.ballRadius;
      const spareGap = 8;
      const spareRight = config.canvasWidth - 8;
      const spareCenterY = hudTop + 8;

      ctx.fillStyle = theme.accentColor ?? theme.ballColor;
      for (let i = 0; i < game.life; i++) {
        const cx = spareRight - spareRadius - i * (spareRadius * 2 + spareGap);
        ctx.beginPath();
        ctx.arc(cx, spareCenterY, spareRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      const spareBlockWidth = game.life * spareRadius * 2 + (game.life - 1) * spareGap;
      ctx.fillStyle = theme.textColor;
      ctx.textAlign = "right";
      ctx.fillText("LIFE", spareRight - spareBlockWidth - 10, hudTop);
      ctx.textAlign = "left";
    }
  }
}
