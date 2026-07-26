/**
 * Renders a folded contribution grid as a standalone SVG string using
 * GitHub's dark 5-level palette. Returned as a string (embedded via
 * `data:image/svg+xml` rather than passed to satori as ~370 individual
 * `<div>`s) because satori's per-node cost makes a full grid of divs
 * expensive enough to risk the Workers CPU budget; satori officially
 * supports `data:image/svg+xml` `<img>` sources instead.
 */

import type { ContributionCell } from "./jogruber";

/** GitHub dark theme's 5-level contribution color scale (level 0-4). */
const LEVEL_COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"] as const;

const CELL_SIZE = 11;
const CELL_GAP = 3;
const CELL_RADIUS = 2;

export type GridSvgOptions = {
  /**
   * True to draw every cell at level 0 — the year as the player left it.
   * A card that says "100% 刈り取った" above a full green grid contradicts
   * itself; the saved image shows the real emptied board, so this one should
   * agree with it (DESIGN-VISUAL §8).
   */
  emptied?: boolean;
};

/** Builds the contribution grid SVG. Returns a minimal 0x0 SVG when `weeks` is empty. */
export function buildContributionGridSvg(weeks: ContributionCell[][], options?: GridSvgOptions): string {
  const columns = weeks.length;
  const step = CELL_SIZE + CELL_GAP;
  const width = columns > 0 ? columns * step - CELL_GAP : 0;
  const height = columns > 0 ? 7 * step - CELL_GAP : 0;

  const rects = weeks
    .flatMap((week, column) =>
      week.map((cell, row) => {
        const x = column * step;
        const y = row * step;
        const level = options?.emptied ? 0 : cell.level;
        return `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="${CELL_RADIUS}" fill="${LEVEL_COLORS[level]}" />`;
      }),
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}</svg>`;
}

/** Base64-encodes an SVG string as a `data:image/svg+xml` URI for embedding in satori HTML. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
