/**
 * Power-up items that occasionally drop from a destroyed brick and fall
 * towards the paddle. Same contract as physics.ts: pure data and pure
 * functions, so every rule here is unit-testable without a canvas, a clock
 * or a `Game`.
 */

import type { BrickRect, Paddle } from "./physics";

/**
 * `multiBall` splits the ball in play into several; `extraPaddle` grows a
 * side bar on each side of the paddle for a limited time.
 */
export type ItemKind = "multiBall" | "extraPaddle";

export type Item = {
  kind: ItemKind;
  /** Centre of the item, not its top-left corner. */
  x: number;
  y: number;
  /** Side length of the (square) item. */
  size: number;
  /** Falling speed in px/sec. Items only ever move straight down. */
  vy: number;
};

/** The item's axis-aligned box, derived from its centre and size. */
export function itemRect(item: Item): BrickRect {
  return {
    x: item.x - item.size / 2,
    y: item.y - item.size / 2,
    width: item.size,
    height: item.size,
  };
}

/** Advances the item by its falling speed over `dt` seconds. */
export function moveItem(item: Item, dt: number): Item {
  return { ...item, y: item.y + item.vy * dt };
}

/** Box-vs-box overlap between the item and a paddle (or side bar). */
export function isItemCaught(item: Item, paddle: Paddle): boolean {
  const rect = itemRect(item);
  return (
    rect.x < paddle.x + paddle.width &&
    rect.x + rect.width > paddle.x &&
    rect.y < paddle.y + paddle.height &&
    rect.y + rect.height > paddle.y
  );
}

/** True once the item has fallen entirely past the bottom of the canvas. */
export function isItemOffScreen(item: Item, canvasHeight: number): boolean {
  return item.y - item.size / 2 > canvasHeight;
}
