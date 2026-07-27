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
  /** Marquee amber, not a page colour — see the note where content.ts builds this. */
  ballColor: string;
  textColor: string;
  /** The page's own background, used as the plate behind the HUD text. */
  backgroundColor: string;
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

const HUD_FONT_SIZE_PX = 12;
const HUD_FONT = `600 ${HUD_FONT_SIZE_PX}px -apple-system, BlinkMacSystemFont, sans-serif`;
const HUD_MARGIN_PX = 4;
/** Clear air between the HUD plates and the paddle they sit above. */
const HUD_PADDLE_CLEARANCE_PX = 3;
/** Padding around the HUD text, inside its plate. */
const HUD_PLATE_PADDING_X_PX = 5;
const HUD_PLATE_PADDING_Y_PX = 3;
/** Slightly see-through so the plate reads as part of the overlay, not a page element. */
const HUD_PLATE_ALPHA = 0.85;
const HUD_PLATE_RADIUS_PX = 3;

/**
 * Shown while the ball is still parked on the paddle, mirroring the web
 * version's guide overlay so both halves of the game read the same. Placed
 * in the empty band between the grass and the paddle — over the grass it
 * would hide the very bricks it is telling you to aim at.
 */
const GUIDE_TEXT = "クリック / Space で発射";
const GUIDE_FONT_SIZE_PX = 13;
const GUIDE_FONT = `600 ${GUIDE_FONT_SIZE_PX}px -apple-system, BlinkMacSystemFont, sans-serif`;

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

  /**
   * All of them: `extraPaddle` puts a side bar on each side of the paddle.
   *
   * Pill-shaped, matching core's `render()` — the paddle is one of the two
   * moving parts the web version and this extension share, so it is drawn
   * the same shape in both. `roundRect` is Chrome 99+ (the extension targets
   * chrome120); the sharp fallback is for the tests' canvas stubs.
   */
  function drawPaddles(ctx: CanvasRenderingContext2D, game: Game): void {
    ctx.fillStyle = theme.paddleColor;
    for (const paddle of game.paddleStates) {
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, paddle.height / 2);
        ctx.fill();
      } else {
        ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
      }
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

  /**
   * One HUD label on a plate in the page's own background colour.
   *
   * The overlay canvas is transparent, so the label sits directly on
   * whatever GitHub renders below the grass. Text alone lost that contest:
   * a drop shadow only helps light text on dark, and half the readers have
   * the opposite. The plate makes legibility independent of what's beneath.
   */
  function drawHudLabel(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number): void {
    const metrics = ctx.measureText(text);
    // jsdom's TextMetrics has neither ascent nor descent; the nominal font
    // size is a good enough box there, and this is only ever cosmetic.
    const ascent = metrics.actualBoundingBoxAscent || HUD_FONT_SIZE_PX;
    const descent = metrics.actualBoundingBoxDescent || 0;

    const plateX = x - HUD_PLATE_PADDING_X_PX;
    const plateY = baseline - ascent - HUD_PLATE_PADDING_Y_PX;
    const plateWidth = metrics.width + HUD_PLATE_PADDING_X_PX * 2;
    const plateHeight = ascent + descent + HUD_PLATE_PADDING_Y_PX * 2;

    ctx.globalAlpha = HUD_PLATE_ALPHA;
    ctx.fillStyle = theme.backgroundColor;
    // `roundRect` is Chrome 99+ and the extension targets chrome120, so the
    // rounded plate is what ships; the square fallback is for hosts (and
    // the tests' canvas stubs) that only implement the 2D basics.
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(plateX, plateY, plateWidth, plateHeight, HUD_PLATE_RADIUS_PX);
      ctx.fill();
    } else {
      ctx.fillRect(plateX, plateY, plateWidth, plateHeight);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = theme.textColor;
    ctx.fillText(text, x, baseline);
  }

  /**
   * Score left, life right, both sitting just above the paddle's row.
   *
   * Pinned to the canvas bottom instead, they shared a line with the paddle:
   * the bar slid straight through "Score" on its way left and parked on top
   * of "Life" at the right end (measured on the real board: paddle 179-186px,
   * HUD plate 172-190px). The paddle's y never changes, so keying off it
   * keeps the two apart whatever the grass geometry works out to.
   */
  function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
    const width = game.config.canvasWidth;
    const baseline = game.paddleState.y - HUD_PADDLE_CLEARANCE_PX - HUD_PLATE_PADDING_Y_PX;

    ctx.font = HUD_FONT;
    ctx.textBaseline = "bottom";

    drawHudLabel(ctx, `Score: ${game.score}`, HUD_MARGIN_PX + HUD_PLATE_PADDING_X_PX, baseline);

    const lifeText = `Life: ${game.life}`;
    const lifeWidth = ctx.measureText(lifeText).width;
    drawHudLabel(ctx, lifeText, width - lifeWidth - HUD_MARGIN_PX - HUD_PLATE_PADDING_X_PX, baseline);
  }

  /**
   * Only while the ball is waiting to be launched — the same states the web
   * version shows its guide in.
   *
   * Centred in the free band between the grass (which fills the board's top
   * half) and the paddle, so it neither hides the bricks it is telling you
   * to aim at nor lands on the HUD sitting above the paddle.
   */
  function drawGuide(ctx: CanvasRenderingContext2D, game: Game): void {
    if (game.state !== "ready" && game.state !== "ballLost") return;

    ctx.font = GUIDE_FONT;
    ctx.textBaseline = "bottom";
    const width = ctx.measureText(GUIDE_TEXT).width;
    const grassBottom = game.config.canvasHeight / 2;
    const centre = (grassBottom + game.paddleState.y) / 2;
    drawHudLabel(ctx, GUIDE_TEXT, (game.config.canvasWidth - width) / 2, centre + GUIDE_FONT_SIZE_PX / 2);
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
    drawGuide(ctx, game);
  }

  return { spawnBurst, draw };
}
