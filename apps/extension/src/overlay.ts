/**
 * The transparent canvas drawn on top of the real grass `td`s. It only
 * ever draws the ball/paddle/particles/HUD (see renderer.ts) — never the
 * bricks themselves, since the `td`s underneath already look exactly like
 * bricks and painting over them would defeat the "the real grass changes
 * colour" effect (see td-paint.ts).
 */

import type { GameConfig } from "@kusakuzushi/core";

import type { GrassGeometry } from "./grass-dom";

const OVERLAY_Z_INDEX = 100;

export type Overlay = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  destroy(): void;
};

/**
 * Creates the overlay canvas and appends it to `doc.body`. Returns `null`
 * if a 2D context isn't available (e.g. under jsdom, or an exotic
 * browser) — the caller must treat that as "can't start the game" rather
 * than crash.
 */
export function createOverlay(doc: Document, geometry: GrassGeometry, config: GameConfig): Overlay | null {
  const canvas = doc.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // `devicePixelRatio` isn't on the `Document`/`Window` types uniformly
  // across DOM lib versions in a content-script context; fall back to 1
  // (no supersampling) if it's unavailable.
  const dpr = doc.defaultView?.devicePixelRatio ?? 1;

  canvas.width = Math.round(config.canvasWidth * dpr);
  canvas.height = Math.round(config.canvasHeight * dpr);
  ctx.scale(dpr, dpr);

  // `position: fixed` (as DESIGN.md §5 originally called for) doesn't
  // survive page scroll — the overlay would separate from the grass the
  // instant the user scrolls. `absolute` against page coordinates tracks
  // the grass table naturally instead, at the cost of needing scroll-
  // inclusive coordinates from the caller (see grass-dom.ts's
  // `CellRect`/`GrassGeometry`).
  canvas.style.position = "absolute";
  canvas.style.left = `${geometry.originX - geometry.gap}px`;
  canvas.style.top = `${geometry.originY - geometry.gap}px`;
  canvas.style.width = `${config.canvasWidth}px`;
  canvas.style.height = `${config.canvasHeight}px`;
  canvas.style.zIndex = String(OVERLAY_Z_INDEX);
  canvas.style.cursor = "crosshair";

  doc.body.appendChild(canvas);

  return {
    canvas,
    ctx,
    destroy(): void {
      canvas.remove();
    },
  };
}
