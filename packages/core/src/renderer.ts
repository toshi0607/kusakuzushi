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
  particles: Particle[];
  lastTimeMs: number;
};

const rendererStates = new WeakMap<Game, RendererState>();

function brickKey(brick: Brick): string {
  return `${brick.row}:${brick.col}`;
}

function spawnParticles(particles: Particle[], brick: Brick, theme: Theme): void {
  const cx = brick.rect.x + brick.rect.width / 2;
  const cy = brick.rect.y + brick.rect.height / 2;
  const color = theme.particleColor ?? theme.colors[Math.min(Math.max(brick.level, 1), 4)];
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
    state = { destroyedKeys: new Set(), particles: [], lastTimeMs: Date.now() };
    rendererStates.set(game, state);
  }
  return state;
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
export function render(ctx: CanvasRenderingContext2D, game: Game, theme: Theme = LIGHT_THEME): void {
  const config = game.config;
  const state = getState(game);

  const now = Date.now();
  const dt = Math.min(Math.max((now - state.lastTimeMs) / 1000, 0), MAX_FRAME_DT);
  state.lastTimeMs = now;

  for (const brick of game.liveBricks) {
    const key = brickKey(brick);
    if (!brick.alive && !state.destroyedKeys.has(key)) {
      state.destroyedKeys.add(key);
      spawnParticles(state.particles, brick, theme);
    }
  }
  updateParticles(state.particles, dt);

  ctx.clearRect(0, 0, config.canvasWidth, config.canvasHeight);
  ctx.fillStyle = theme.colors[0];
  ctx.fillRect(0, 0, config.canvasWidth, config.canvasHeight);

  for (const brick of game.liveBricks) {
    if (!brick.alive) continue;
    const levelIndex = Math.min(Math.max(brick.level, 1), 4);
    ctx.fillStyle = theme.colors[levelIndex];
    ctx.fillRect(brick.rect.x, brick.rect.y, brick.rect.width, brick.rect.height);
  }

  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(particle.life / particle.maxLife, 0);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;

  const paddle = game.paddleState;
  ctx.fillStyle = theme.paddleColor;
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);

  const ball = game.ballState;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = theme.ballColor;
  ctx.fill();

  ctx.fillStyle = theme.textColor;
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`Score: ${game.score}`, 8, 8);
  ctx.fillText(`Life: ${game.life}`, config.canvasWidth - 88, 8);
}
