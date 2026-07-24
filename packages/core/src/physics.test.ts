import { describe, expect, it } from "vitest";
import {
  detectBrickCollision,
  moveBall,
  reflectOffBrick,
  reflectOffPaddle,
  reflectOffWalls,
} from "./physics";
import type { Ball, BrickRect, Paddle } from "./physics";

function makeBall(overrides: Partial<Ball> = {}): Ball {
  return { x: 50, y: 50, vx: 10, vy: 10, radius: 5, ...overrides };
}

describe("moveBall", () => {
  it("advances position by velocity * dt", () => {
    // #given
    const ball = makeBall({ x: 0, y: 0, vx: 10, vy: -20 });
    // #when
    const next = moveBall(ball, 0.5);
    // #then
    expect(next.x).toBe(5);
    expect(next.y).toBe(-10);
  });
});

describe("reflectOffWalls", () => {
  const bounds = { width: 100, height: 100 };

  it("bounces off the left wall and clamps position", () => {
    // #given ball poking through the left edge, moving left
    const ball = makeBall({ x: 2, y: 50, vx: -5, vy: 0, radius: 5 });
    // #when
    const next = reflectOffWalls(ball, bounds);
    // #then
    expect(next.x).toBe(5);
    expect(next.vx).toBe(5);
  });

  it("bounces off the right wall and clamps position", () => {
    // #given
    const ball = makeBall({ x: 98, y: 50, vx: 5, vy: 0, radius: 5 });
    // #when
    const next = reflectOffWalls(ball, bounds);
    // #then
    expect(next.x).toBe(95);
    expect(next.vx).toBe(-5);
  });

  it("bounces off the top wall and clamps position", () => {
    // #given
    const ball = makeBall({ x: 50, y: 2, vx: 0, vy: -5, radius: 5 });
    // #when
    const next = reflectOffWalls(ball, bounds);
    // #then
    expect(next.y).toBe(5);
    expect(next.vy).toBe(5);
  });

  it("leaves a ball inside the bounds untouched", () => {
    // #given
    const ball = makeBall({ x: 50, y: 50, vx: 3, vy: -4 });
    // #when
    const next = reflectOffWalls(ball, bounds);
    // #then
    expect(next).toEqual(ball);
  });
});

describe("reflectOffPaddle", () => {
  const paddle: Paddle = { x: 40, y: 90, width: 20, height: 5 };

  it("sends the ball straight up (0deg) when it hits dead centre", () => {
    // #given ball centred over the paddle (paddle centre x = 50)
    const ball = makeBall({ x: 50, y: 88, vx: 3, vy: 7 });
    // #when
    const next = reflectOffPaddle(ball, paddle, 100, 60);
    // #then
    expect(next.vx).toBeCloseTo(0);
    expect(next.vy).toBeCloseTo(-100);
  });

  it("deflects the ball by +maxBounceAngleDeg off the left edge", () => {
    // #given ball at the paddle's left edge (relative intersect = -1)
    const ball = makeBall({ x: 40, y: 88 });
    // #when
    const next = reflectOffPaddle(ball, paddle, 100, 60);
    // #then angle = -60deg -> vx negative, magnitude preserved
    const angle = (-60 * Math.PI) / 180;
    expect(next.vx).toBeCloseTo(100 * Math.sin(angle));
    expect(next.vy).toBeCloseTo(-100 * Math.cos(angle));
    expect(Math.hypot(next.vx, next.vy)).toBeCloseTo(100);
  });

  it("deflects the ball by -maxBounceAngleDeg off the right edge", () => {
    // #given ball at the paddle's right edge (relative intersect = +1)
    const ball = makeBall({ x: 60, y: 88 });
    // #when
    const next = reflectOffPaddle(ball, paddle, 100, 60);
    // #then
    const angle = (60 * Math.PI) / 180;
    expect(next.vx).toBeCloseTo(100 * Math.sin(angle));
    expect(next.vy).toBeCloseTo(-100 * Math.cos(angle));
  });

  it("clamps intersect points beyond the paddle edges to +-1", () => {
    // #given ball x far past the paddle's right edge
    const ball = makeBall({ x: 200, y: 88 });
    // #when
    const next = reflectOffPaddle(ball, paddle, 100, 60);
    const angle = (60 * Math.PI) / 180;
    // #then still capped at maxBounceAngleDeg, not further
    expect(next.vx).toBeCloseTo(100 * Math.sin(angle));
  });
});

describe("detectBrickCollision", () => {
  const brick: BrickRect = { x: 40, y: 40, width: 20, height: 20 };

  it("returns null when there is no overlap", () => {
    // #given ball far from the brick
    const ball = makeBall({ x: 0, y: 0, radius: 5 });
    // #then
    expect(detectBrickCollision(ball, brick)).toBeNull();
  });

  it("detects a top collision when the ball approaches from above", () => {
    // #given ball just touching the brick's top edge, centred horizontally
    const ball = makeBall({ x: 50, y: 39, radius: 4 });
    // #then
    expect(detectBrickCollision(ball, brick)).toBe("top");
  });

  it("detects a bottom collision when the ball approaches from below", () => {
    // #given
    const ball = makeBall({ x: 50, y: 61, radius: 4 });
    // #then
    expect(detectBrickCollision(ball, brick)).toBe("bottom");
  });

  it("detects a left collision when the ball approaches from the left", () => {
    // #given
    const ball = makeBall({ x: 39, y: 50, radius: 4 });
    // #then
    expect(detectBrickCollision(ball, brick)).toBe("left");
  });

  it("detects a right collision when the ball approaches from the right", () => {
    // #given
    const ball = makeBall({ x: 61, y: 50, radius: 4 });
    // #then
    expect(detectBrickCollision(ball, brick)).toBe("right");
  });
});

describe("reflectOffBrick", () => {
  it("flips vy for a top/bottom collision", () => {
    // #given
    const ball = makeBall({ vx: 3, vy: -7 });
    // #when / #then
    expect(reflectOffBrick(ball, "top").vy).toBe(7);
    expect(reflectOffBrick(ball, "bottom").vy).toBe(7);
    expect(reflectOffBrick(ball, "top").vx).toBe(3);
  });

  it("flips vx for a left/right collision", () => {
    // #given
    const ball = makeBall({ vx: 3, vy: -7 });
    // #when / #then
    expect(reflectOffBrick(ball, "left").vx).toBe(-3);
    expect(reflectOffBrick(ball, "right").vx).toBe(-3);
    expect(reflectOffBrick(ball, "left").vy).toBe(-7);
  });
});
