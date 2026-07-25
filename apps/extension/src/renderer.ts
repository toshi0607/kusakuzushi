/**
 * The extension's own frame renderer. Deliberately does NOT reuse core's
 * `render()`: that function paints an opaque background + the bricks
 * themselves every frame, which would hide the real `td`s underneath and
 * break the "the actual grass changes colour" effect this extension exists
 * for (td-paint.ts owns brick colour instead). This renderer only ever
 * draws the ball, paddle, particles and HUD onto a cleared (transparent)
 * canvas.
 */

import type { Game, ItemKind } from "@kusakuzushi/core";

export type OverlayTheme = {
  levelColors: readonly string[];
  paddleColor: string;
  ballColor: string;
  textColor: string;
  /**
   * Falling items, one hue per kind — neither the grass nor the ball, and
   * distinct from each other so the two power-ups are told apart by colour
   * before their glyphs are readable.
   */
  itemColors: Readonly<Record<ItemKind, string>>;
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

const PARTICLES_PER_BURST = 6;
const PARTICLE_LIFETIME_SEC = 0.5;
const PARTICLE_MIN_SPEED = 40;
const PARTICLE_SPEED_RANGE = 60;
const PARTICLE_MIN_SIZE = 2;
const PARTICLE_SIZE_RANGE = 2;

/**
 * Item glyph geometry as fractions of the item's side, mirroring core's
 * renderer: three dots for `multiBall`, three bars for `extraPaddle`. The
 * marks are knocked out in the level-0 grass colour, which is the closest
 * thing to a page background this renderer has (the canvas itself is
 * transparent, so a real background colour isn't available here).
 */
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

const HUD_FONT = "11px -apple-system, sans-serif";
const HUD_MARGIN_PX = 4;
const HUD_SHADOW_COLOR = "rgba(0, 0, 0, 0.6)";
const HUD_SHADOW_BLUR_PX = 3;

function clampLevelIndex(level: number): number {
  return Math.min(Math.max(level, 1), 4);
}

/**
 * Builds a renderer instance holding its own particle state (mirrors core
 * renderer.ts's per-`Game` `WeakMap` state, but this extension only ever
 * runs one `Game` at a time, so a plain closure is enough).
 */
export function createOverlayRenderer(theme: OverlayTheme): {
  spawnBurst(x: number, y: number, level: number): void;
  draw(ctx: CanvasRenderingContext2D, game: Game, dtSec: number): void;
} {
  const particles: Particle[] = [];

  function spawnBurst(x: number, y: number, level: number): void {
    const color = theme.levelColors[clampLevelIndex(level)];

    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      const angle = (Math.PI * 2 * i) / PARTICLES_PER_BURST + Math.random() * 0.4;
      const speed = PARTICLE_MIN_SPEED + Math.random() * PARTICLE_SPEED_RANGE;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: PARTICLE_LIFETIME_SEC,
        maxLife: PARTICLE_LIFETIME_SEC,
        size: PARTICLE_MIN_SIZE + Math.random() * PARTICLE_SIZE_RANGE,
        color,
      });
    }
  }

  function updateParticles(dtSec: number): void {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.x += particle.vx * dtSec;
      particle.y += particle.vy * dtSec;
      particle.life -= dtSec;
      if (particle.life <= 0) {
        particles.splice(i, 1);
      }
    }
  }

  function drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(particle.life / particle.maxLife, 0);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }

  /** All of them: `extraPaddle` puts a side bar on each side of the paddle. */
  function drawPaddles(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.fillStyle = theme.paddleColor;
    for (const paddle of game.paddleStates) {
      ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
    }
  }

  /** All of them: `multiBall` splits the ball into several. */
  function drawBalls(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.fillStyle = theme.ballColor;
    for (const ball of game.ballStates) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawItems(ctx: CanvasRenderingContext2D, game: Game): void {
    for (const item of game.itemStates) {
      const size = item.size;
      const left = item.x - size / 2;
      const top = item.y - size / 2;

      ctx.fillStyle = theme.itemColors[item.kind];
      ctx.fillRect(left, top, size, size);

      ctx.fillStyle = theme.levelColors[0];
      if (item.kind === "multiBall") {
        const dot = size * ITEM_DOT_SIZE_RATIO;
        for (const [dx, dy] of ITEM_DOT_OFFSETS) {
          ctx.fillRect(left + size * dx, top + size * dy, dot, dot);
        }
        continue;
      }
      for (const dx of ITEM_BAR_LEFT_RATIOS) {
        ctx.fillRect(
          left + size * dx,
          top + size * ITEM_BAR_TOP_RATIO,
          size * ITEM_BAR_WIDTH_RATIO,
          size * ITEM_BAR_HEIGHT_RATIO,
        );
      }
    }
  }

  /** Score bottom-left, life bottom-right — the paddle's half of the board, which real grass never occupies. */
  function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
    const height = game.config.canvasHeight;
    const width = game.config.canvasWidth;

    ctx.font = HUD_FONT;
    ctx.textBaseline = "bottom";
    ctx.fillStyle = theme.textColor;
    ctx.shadowColor = HUD_SHADOW_COLOR;
    ctx.shadowBlur = HUD_SHADOW_BLUR_PX;

    ctx.fillText(`Score: ${game.score}`, HUD_MARGIN_PX, height - HUD_MARGIN_PX);

    const lifeText = `Life: ${game.life}`;
    const lifeWidth = ctx.measureText(lifeText).width;
    ctx.fillText(lifeText, width - lifeWidth - HUD_MARGIN_PX, height - HUD_MARGIN_PX);

    ctx.shadowBlur = 0;
  }

  function draw(ctx: CanvasRenderingContext2D, game: Game, dtSec: number): void {
    updateParticles(dtSec);

    // No background fill here (unlike core's render()) — leaving the
    // canvas transparent is what lets the real `td`s show through.
    ctx.clearRect(0, 0, game.config.canvasWidth, game.config.canvasHeight);

    drawParticles(ctx);
    drawItems(ctx, game);
    drawPaddles(ctx, game);
    drawBalls(ctx, game);
    drawHud(ctx, game);
  }

  return { spawnBurst, draw };
}
