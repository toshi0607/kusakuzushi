/**
 * The extension's own frame renderer. Deliberately does NOT reuse core's
 * `render()`: that function paints an opaque background + the bricks
 * themselves every frame, which would hide the real `td`s underneath and
 * break the "the actual grass changes colour" effect this extension exists
 * for (td-paint.ts owns brick colour instead). This renderer only ever
 * draws the ball, paddle, particles and HUD onto a cleared (transparent)
 * canvas.
 */

import type { Game } from "@kusakuzushi/core";

export type OverlayTheme = {
  levelColors: readonly string[];
  paddleColor: string;
  ballColor: string;
  textColor: string;
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

  function drawPaddle(ctx: CanvasRenderingContext2D, game: Game): void {
    const paddle = game.paddleState;
    ctx.fillStyle = theme.paddleColor;
    ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
  }

  function drawBall(ctx: CanvasRenderingContext2D, game: Game): void {
    const ball = game.ballState;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = theme.ballColor;
    ctx.fill();
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
    drawPaddle(ctx, game);
    drawBall(ctx, game);
    drawHud(ctx, game);
  }

  return { spawnBurst, draw };
}
