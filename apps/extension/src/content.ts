/**
 * Orchestrates the extension on a GitHub profile page: injects the launch
 * button, wires input to a `Game`, and keeps the overlay canvas + real
 * grass `td`s in sync with it. This is the only module that touches
 * `document`/`window` directly for anything beyond what grass-dom.ts
 * already abstracts.
 */

import type { ContributionGrid, GameConfig, GameState } from "@kusakuzushi/core";
import { DARK_THEME, DEFAULT_CONFIG, Game, LIGHT_THEME, MAX_FRAME_DT } from "@kusakuzushi/core";

import { deriveConfig, toExtensionGrid } from "./adapter";
import type { GrassCell, GrassGeometry } from "./grass-dom";
import { findGraphContainer, findGrassTable, measureGeometry, readGrassCells, readLevelColors } from "./grass-dom";
import type { Overlay } from "./overlay";
import { createOverlay } from "./overlay";
import type { OverlayTheme } from "./renderer";
import { createOverlayRenderer } from "./renderer";
import type { TdPainter } from "./td-paint";
import { createTdPainter } from "./td-paint";

const BUTTON_ID = "kusakuzushi-launch";
const MESSAGE_ID = "kusakuzushi-message";
const BANNER_ID = "kusakuzushi-result-banner";

const BUTTON_LABEL_IDLE = "🎮 崩す";
const BUTTON_LABEL_ACTIVE = "やめる";
const NO_BRICKS_MESSAGE = "崩す草がありません🌵";
const RESULT_BANNER_Z_INDEX = 101;

/** Fixed nudge, in px, per ArrowLeft/ArrowRight keydown — a constant step rather than held-key velocity, since the board is small enough that per-frame acceleration isn't needed. */
const ARROW_STEP_PX = 24;

export type Session = { stop(): void };

let activeSession: Session | null = null;

function usernameFromPath(pathname: string): string {
  const [first] = pathname.split("/").filter((segment) => segment.length > 0);
  return first ?? "you";
}

function hasLiveBricks(grid: ContributionGrid): boolean {
  return grid.weeks.some((week) => week.some((cell) => cell.level >= 1));
}

/** `${row}:${col}` -> that cell's date, skipping `toGrid`'s empty-date padding cells. */
function buildDateLookup(grid: ContributionGrid): Map<string, string> {
  const lookup = new Map<string, string>();
  grid.weeks.forEach((week, col) => {
    week.forEach((cell, row) => {
      if (cell.date) lookup.set(`${row}:${col}`, cell.date);
    });
  });
  return lookup;
}

function buildElementLookup(cells: readonly GrassCell[]): Map<string, HTMLElement> {
  const lookup = new Map<string, HTMLElement>();
  for (const cell of cells) lookup.set(cell.date, cell.el);
  return lookup;
}

function buildLevelLookup(cells: readonly GrassCell[]): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const cell of cells) lookup.set(cell.date, cell.level);
  return lookup;
}

function prefersDarkTheme(view: Window): boolean {
  if (typeof view.matchMedia !== "function") return false;
  try {
    return view.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // Some content-script hosts (or jsdom without full CSSOM support)
    // don't implement matchMedia fully; default to light rather than crash.
    return false;
  }
}

/** Everything created for a single play-through; `teardown` undoes all of it. */
type GameRuntime = {
  teardown(): void;
};

function createGameRuntime(
  doc: Document,
  view: Window,
  grid: ContributionGrid,
  grassCells: readonly GrassCell[],
  geometry: GrassGeometry,
  onFinished: (restart: boolean) => void,
): GameRuntime | null {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...deriveConfig(geometry) };
  const maybeOverlay = createOverlay(doc, geometry, config);
  if (!maybeOverlay) return null;
  // Re-bound to a fresh, explicitly-typed const so TS keeps the
  // non-null narrowing inside the function declarations below (it
  // doesn't reliably carry the narrowing of `maybeOverlay` itself into
  // nested closures) — same pattern apps/web/src/session.ts uses for `ctx`.
  const overlay: Overlay = maybeOverlay;

  const game = new Game(grid, config);

  const themeBase = prefersDarkTheme(view) ? DARK_THEME : LIGHT_THEME;
  const levelColors = readLevelColors([...grassCells], view) ?? themeBase.colors;
  const overlayTheme: OverlayTheme = {
    levelColors,
    paddleColor: themeBase.paddleColor,
    ballColor: themeBase.ballColor,
    textColor: themeBase.textColor,
  };

  const painter: TdPainter = createTdPainter(levelColors);
  const overlayRenderer = createOverlayRenderer(overlayTheme);
  const dateByRowCol = buildDateLookup(grid);
  const elByDate = buildElementLookup(grassCells);
  const levelByDate = buildLevelLookup(grassCells);

  game.onBrickHit = (brick): void => {
    const date = dateByRowCol.get(`${brick.row}:${brick.col}`);
    if (!date) return;
    const el = elByDate.get(date);
    if (!el) return;

    painter.paint(el, brick.alive ? brick.level : 0);

    if (!brick.alive) {
      const cx = brick.rect.x + brick.rect.width / 2;
      const cy = brick.rect.y + brick.rect.height / 2;
      // The shards keep the day's *original* colour, not `brick.level`:
      // a brick is only destroyed on the hit that takes it from level 1 to
      // 0, so both of those would always paint the palest green regardless
      // of how dark the day actually was.
      overlayRenderer.spawnBurst(cx, cy, levelByDate.get(date) ?? 1);
    }
  };

  // Mirrors overlay.ts's own left/top math so the result banner (drawn as
  // a separate DOM element, not on the canvas) lines up with it.
  const overlayLeft = geometry.originX - geometry.gap;
  const overlayTop = geometry.originY - geometry.gap;

  let paddleX = config.canvasWidth / 2;
  let bannerEl: HTMLElement | null = null;

  function canvasXFromClientX(clientX: number): number {
    const rect = overlay.canvas.getBoundingClientRect();
    return clientX - rect.left;
  }

  function handleMouseMove(event: MouseEvent): void {
    paddleX = canvasXFromClientX(event.clientX);
    game.movePaddle(paddleX);
  }

  function handleTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    paddleX = canvasXFromClientX(touch.clientX);
    game.movePaddle(paddleX);
  }

  function handleCanvasClick(): void {
    game.launch();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Once the result banner is up the game no longer owns the keyboard —
    // swallowing Space here would stop the user pressing its buttons with
    // the keyboard (same fix as the web app's session 2 review L1).
    if (game.state === "gameOver" || game.state === "clear") return;

    if (event.code === "Space") {
      event.preventDefault();
      game.launch();
      return;
    }
    if (event.code === "ArrowLeft") {
      paddleX -= ARROW_STEP_PX;
      game.movePaddle(paddleX);
    } else if (event.code === "ArrowRight") {
      paddleX += ARROW_STEP_PX;
      game.movePaddle(paddleX);
    }
  }

  view.addEventListener("mousemove", handleMouseMove);
  view.addEventListener("keydown", handleKeyDown);
  overlay.canvas.addEventListener("click", handleCanvasClick);
  overlay.canvas.addEventListener("touchmove", handleTouchMove);

  function removeBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
  }

  function showResultBanner(state: Extract<GameState, "gameOver" | "clear">): void {
    removeBanner();

    const banner = doc.createElement("div");
    banner.id = BANNER_ID;
    banner.style.position = "absolute";
    banner.style.left = `${overlayLeft}px`;
    banner.style.top = `${overlayTop + config.canvasHeight / 2}px`;
    banner.style.width = `${config.canvasWidth}px`;
    banner.style.height = `${config.canvasHeight / 2}px`;
    banner.style.zIndex = String(RESULT_BANNER_Z_INDEX);
    banner.style.display = "flex";
    banner.style.flexDirection = "column";
    banner.style.alignItems = "center";
    banner.style.justifyContent = "center";
    banner.style.gap = "4px";
    banner.style.background = "rgba(255, 255, 255, 0.85)";
    banner.style.font = "12px -apple-system, sans-serif";

    const heading = doc.createElement("p");
    heading.textContent = state === "clear" ? "🌱 完全刈り取り!" : "ゲームオーバー";
    banner.appendChild(heading);

    const score = doc.createElement("p");
    score.textContent = `Score: ${game.score}`;
    banner.appendChild(score);

    const actions = doc.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const retryButton = doc.createElement("button");
    retryButton.type = "button";
    retryButton.className = "btn btn-sm";
    retryButton.textContent = "もう一回";
    retryButton.addEventListener("click", () => {
      onFinished(true);
    });
    actions.appendChild(retryButton);

    const quitButton = doc.createElement("button");
    quitButton.type = "button";
    quitButton.className = "btn btn-sm";
    quitButton.textContent = "やめる";
    quitButton.addEventListener("click", () => {
      onFinished(false);
    });
    actions.appendChild(quitButton);

    banner.appendChild(actions);
    bannerEl = banner;
    doc.body.appendChild(banner);
  }

  let rafId = 0;
  let lastTimeMs = view.performance.now();

  function frame(now: number): void {
    const dt = Math.min(Math.max((now - lastTimeMs) / 1000, 0), MAX_FRAME_DT);
    lastTimeMs = now;

    game.update(dt);
    overlayRenderer.draw(overlay.ctx, game, dt);

    if (game.state === "gameOver" || game.state === "clear") {
      showResultBanner(game.state);
      return;
    }

    rafId = view.requestAnimationFrame(frame);
  }
  rafId = view.requestAnimationFrame(frame);

  function teardown(): void {
    view.cancelAnimationFrame(rafId);
    view.removeEventListener("mousemove", handleMouseMove);
    view.removeEventListener("keydown", handleKeyDown);
    overlay.canvas.removeEventListener("click", handleCanvasClick);
    overlay.canvas.removeEventListener("touchmove", handleTouchMove);
    overlay.destroy();
    painter.restoreAll();
    removeBanner();
  }

  return { teardown };
}

/**
 * Mounts the extension on `doc` if it looks like a GitHub profile page.
 * Idempotent: a second call while already mounted just returns the
 * existing session (see the module-scope `activeSession` guard at the
 * bottom of this file, which is what actually drives repeat calls from
 * `turbo:load`/`DOMContentLoaded`/the immediate top-level call).
 */
export function mount(doc: Document, view: Window): Session | null {
  if (activeSession) return activeSession;

  const maybeTable = findGrassTable(doc);
  if (!maybeTable) return null;
  // See the identical `overlay` re-binding in createGameRuntime: keeps the
  // non-null narrowing available inside startGame's closure below.
  const table: HTMLElement = maybeTable;

  const container = findGraphContainer(doc) ?? table.parentElement ?? doc.body;

  // A stale button surviving an incomplete teardown (e.g. a bfcache
  // restore) is reused rather than duplicated.
  let button = doc.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = doc.createElement("button");
    button.type = "button";
    button.id = BUTTON_ID;
    button.className = "btn btn-sm";
    button.textContent = BUTTON_LABEL_IDLE;
    container.appendChild(button);
  }
  const launchButton = button;

  let message: HTMLElement | null = null;
  let runtime: GameRuntime | null = null;
  let stopped = false;

  function clearMessage(): void {
    message?.remove();
    message = null;
  }

  function showMessage(text: string): void {
    clearMessage();
    const el = doc.createElement("span");
    el.id = MESSAGE_ID;
    el.style.marginLeft = "8px";
    el.textContent = text;
    container.appendChild(el);
    message = el;
  }

  function endGame(): void {
    if (!runtime) return;
    runtime.teardown();
    runtime = null;
    launchButton.textContent = BUTTON_LABEL_IDLE;
  }

  function startGame(): void {
    clearMessage();

    const username = usernameFromPath(view.location.pathname);
    const grassCells = readGrassCells(table);
    const grid = toExtensionGrid(username, grassCells);

    if (!hasLiveBricks(grid)) {
      showMessage(NO_BRICKS_MESSAGE);
      return;
    }

    const rects = grassCells.map((cell) => {
      const rect = cell.el.getBoundingClientRect();
      return {
        left: rect.left + view.scrollX,
        top: rect.top + view.scrollY,
        width: rect.width,
        height: rect.height,
      };
    });
    const geometry = measureGeometry(rects);
    if (!geometry) return;

    // A retry re-enters `startGame` *after* teardown has restored every
    // repainted `td`, so the second round starts from the untouched grass.
    const created = createGameRuntime(doc, view, grid, grassCells, geometry, (restart) => {
      endGame();
      if (restart) startGame();
    });
    if (!created) return;

    runtime = created;
    launchButton.textContent = BUTTON_LABEL_ACTIVE;
  }

  function handleButtonClick(): void {
    if (runtime) {
      endGame();
    } else {
      startGame();
    }
  }
  launchButton.addEventListener("click", handleButtonClick);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    endGame();
    clearMessage();
    launchButton.removeEventListener("click", handleButtonClick);
    launchButton.remove();
    doc.removeEventListener("turbo:before-render", stop);
    view.removeEventListener("pagehide", stop);
    activeSession = null;
  }

  doc.addEventListener("turbo:before-render", stop);
  view.addEventListener("pagehide", stop);

  activeSession = { stop };
  return activeSession;
}

// The extension's actual entry point. Guarded so this module stays
// side-effect-free (and therefore directly testable via `mount`/`Session`)
// when imported from vitest under jsdom without a real page.
if (typeof document !== "undefined") {
  const boot = (): void => {
    mount(document, window);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("turbo:load", boot);
  document.addEventListener("turbo:before-render", () => activeSession?.stop());
  window.addEventListener("pagehide", () => activeSession?.stop());
}
