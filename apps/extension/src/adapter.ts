/**
 * Bridges the GitHub grass DOM (`grass-dom.ts`) to core's `ContributionGrid`
 * / `GameConfig`. GitHub's contribution calendar never exposes a per-day
 * count in the DOM — only the 0-4 `data-level` — so this is also the score
 * source of truth for the extension: without injecting a synthetic count,
 * every brick's `count` stays 0 and `game.ts`'s scoring (`score +=
 * brick.count * multiplier`) never awards any points (session 1 review L4).
 */

import type { Cell, ContributionGrid, GameConfig } from "@kusakuzushi/core";
import { toGrid } from "@kusakuzushi/core";

import type { GrassGeometry } from "./grass-dom";

/** Rows per week, matching GitHub's Sunday(0)-Saturday(6) grid (see game.ts's own ROWS constant). */
const ROWS_PER_WEEK = 7;

/** Multiplier applied to `cellHeight` for the ball radius on the narrow overlay board. */
const BALL_RADIUS_HEIGHT_RATIO = 0.35;
const MIN_BALL_RADIUS_PX = 3;

/** Paddle width is `PADDLE_WIDTH_STRIDE_MULTIPLIER` grass columns wide. */
const PADDLE_WIDTH_STRIDE_MULTIPLIER = 5;
const MIN_PADDLE_WIDTH_PX = 48;

const PADDLE_HEIGHT_RATIO = 0.7;
const MIN_PADDLE_HEIGHT_PX = 6;

const PADDLE_MARGIN_BOTTOM_RATIO = 0.8;
const MIN_PADDLE_MARGIN_BOTTOM_PX = 6;

/** Ball crosses the whole board height in 1/0.8 = 1.25s — tuned for the ~194px real board. */
const BALL_SPEED_HEIGHT_RATIO = 0.8;

/**
 * A dropped item is one grass cell across, so it reads as a cell falling
 * out of the graph. core's 14px default would be larger than the 10px cells
 * it drops from on this board.
 */
const MIN_ITEM_SIZE_PX = 6;
/** Same share of the board per second as core's default (120px on a 480px board). */
const ITEM_FALL_SPEED_HEIGHT_RATIO = 0.25;

/** `level` squared, so a brick's score value scales with how "green" the day was. Negative levels clamp to 0. */
export function levelToCount(level: number): number {
  return level > 0 ? level * level : 0;
}

function clampLevel(level: number): 0 | 1 | 2 | 3 | 4 {
  const rounded = Math.round(level);
  return Math.min(4, Math.max(0, rounded)) as 0 | 1 | 2 | 3 | 4;
}

/**
 * Converts grass cells (date + level only) into core's `ContributionGrid`,
 * injecting `count = level²` — see the module doc comment for why this is
 * required, not cosmetic.
 */
export function toExtensionGrid(
  username: string,
  cells: readonly { date: string; level: number }[],
): ContributionGrid {
  const mapped: Cell[] = cells.map((cell) => {
    const level = clampLevel(cell.level);
    return { date: cell.date, count: levelToCount(level), level };
  });
  return toGrid(username, mapped);
}

/**
 * Derives a `GameConfig` overlay that makes core's brick rects (see
 * `computeLayout` in game.ts) land exactly on top of the real `td`s
 * `geometry` was measured from. The formulas are derived from
 * `computeLayout`'s own math (brickWidth/brickHeight/brickAreaTop) solved
 * for a canvas that reproduces `geometry`'s cell size and gap — see
 * DESIGN.md / tasks/todo.md "幾何の解". Do not change these without
 * re-deriving them: they are the reason the overlay isn't fixed pixels off
 * from the grass it's drawn over.
 */
export function deriveConfig(geometry: GrassGeometry): Partial<GameConfig> {
  const { cellWidth, cellHeight, gap, cols } = geometry;

  const canvasWidth = cols * (cellWidth + gap) + gap;
  // brickAreaTop=gap, brickAreaHeight=7*brickHeight+8*gap (computeLayout's
  // own math), so H/2 = brickAreaTop + brickAreaHeight = 7*cellHeight +
  // 9*gap — the "+2" below is that extra brickAreaTop gap plus the
  // outer-edge gap computeLayout adds beyond the 7 inter-row gaps. This
  // keeps the grass in the top half; the row stride itself comes from
  // `brickHeightPx` below.
  const canvasHeight = 2 * (ROWS_PER_WEEK * cellHeight + (ROWS_PER_WEEK + 2) * gap);

  return {
    canvasWidth,
    canvasHeight,
    brickGapPx: gap,
    // core's default brick is square (its side = its width). Here the real
    // `td`s are the truth: `measureGeometry` reads width and height
    // independently, so pin the height rather than let a width/height
    // disagreement drift the overlay further down with every row.
    brickHeightPx: cellHeight,
    ballRadius: Math.max(MIN_BALL_RADIUS_PX, cellHeight * BALL_RADIUS_HEIGHT_RATIO),
    paddleWidth: Math.max(MIN_PADDLE_WIDTH_PX, (cellWidth + gap) * PADDLE_WIDTH_STRIDE_MULTIPLIER),
    paddleHeight: Math.max(MIN_PADDLE_HEIGHT_PX, cellHeight * PADDLE_HEIGHT_RATIO),
    paddleMarginBottom: Math.max(MIN_PADDLE_MARGIN_BOTTOM_PX, cellHeight * PADDLE_MARGIN_BOTTOM_RATIO),
    ballSpeed: canvasHeight * BALL_SPEED_HEIGHT_RATIO,
    itemSize: Math.max(MIN_ITEM_SIZE_PX, cellHeight),
    itemFallSpeed: canvasHeight * ITEM_FALL_SPEED_HEIGHT_RATIO,
  };
}
