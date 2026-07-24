/**
 * Deterministic, side-effect-free physics primitives for the block-breaker
 * simulation. Every function is a pure function of its inputs so it can be
 * unit tested without a canvas, a clock, or a Game instance.
 */

export type Ball = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

export type Paddle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrickRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Bounds = { width: number; height: number };

/** Which edge of a rect the ball collided with. */
export type CollisionSide = "top" | "bottom" | "left" | "right";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Advances the ball's position by its current velocity over `dt` seconds. */
export function moveBall(ball: Ball, dt: number): Ball {
  return { ...ball, x: ball.x + ball.vx * dt, y: ball.y + ball.vy * dt };
}

/**
 * Bounces the ball off the left, right and top edges of the play field,
 * clamping its position back inside bounds to prevent tunnelling on the
 * next frame. The bottom edge is intentionally not handled here — falling
 * past it is a "ball lost" event, not a wall bounce.
 */
export function reflectOffWalls(ball: Ball, bounds: Bounds): Ball {
  let { x, y, vx, vy } = ball;
  const r = ball.radius;

  if (x - r < 0) {
    x = r;
    vx = Math.abs(vx);
  } else if (x + r > bounds.width) {
    x = bounds.width - r;
    vx = -Math.abs(vx);
  }

  if (y - r < 0) {
    y = r;
    vy = Math.abs(vy);
  }

  return { ...ball, x, y, vx, vy };
}

/**
 * Reflects the ball off the paddle. The bounce angle varies linearly with
 * where the ball struck the paddle: dead centre sends it straight up (0°),
 * the paddle's edges send it out at ±`maxBounceAngleDeg` from vertical.
 * Speed is held constant at `speed` so the game never accelerates the ball
 * through repeated bounces (constant-speed is a deliberate design choice —
 * see game.ts).
 */
export function reflectOffPaddle(
  ball: Ball,
  paddle: Paddle,
  speed: number,
  maxBounceAngleDeg: number,
): Ball {
  const paddleCenterX = paddle.x + paddle.width / 2;
  const halfWidth = paddle.width / 2;
  const relativeIntersect = halfWidth === 0 ? 0 : clamp((ball.x - paddleCenterX) / halfWidth, -1, 1);
  const angleRad = relativeIntersect * (maxBounceAngleDeg * (Math.PI / 180));

  return {
    ...ball,
    y: paddle.y - ball.radius,
    vx: speed * Math.sin(angleRad),
    vy: -speed * Math.cos(angleRad),
  };
}

/**
 * Circle-vs-AABB collision test. Returns the rect edge the ball struck
 * (chosen as the axis with the smallest penetration depth, i.e. the
 * minimum-translation-vector heuristic) or `null` if there is no overlap.
 */
export function detectBrickCollision(ball: Ball, rect: BrickRect): CollisionSide | null {
  const closestX = clamp(ball.x, rect.x, rect.x + rect.width);
  const closestY = clamp(ball.y, rect.y, rect.y + rect.height);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;

  if (dx * dx + dy * dy > ball.radius * ball.radius) {
    return null;
  }

  const overlapLeft = ball.x + ball.radius - rect.x;
  const overlapRight = rect.x + rect.width - (ball.x - ball.radius);
  const overlapTop = ball.y + ball.radius - rect.y;
  const overlapBottom = rect.y + rect.height - (ball.y - ball.radius);
  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

  if (minOverlap === overlapTop) return "top";
  if (minOverlap === overlapBottom) return "bottom";
  if (minOverlap === overlapLeft) return "left";
  return "right";
}

/** Flips the ball's velocity component perpendicular to the struck edge. */
export function reflectOffBrick(ball: Ball, side: CollisionSide): Ball {
  if (side === "top" || side === "bottom") {
    return { ...ball, vy: -ball.vy };
  }
  return { ...ball, vx: -ball.vx };
}
