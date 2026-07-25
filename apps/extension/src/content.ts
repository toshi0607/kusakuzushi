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

/**
 * The button the live session actually owns. Tracked by element identity
 * rather than by id, because a cached DOM snapshot can contain a *copy* of
 * our button that no session is listening to — `getElementById` would call
 * that "still mounted" and leave the page with a dead button.
 */
let activeButton: HTMLElement | null = null;

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

type PageColors = { foreground: string; background: string };

/**
 * Samples the page's own text and background colour. GitHub's theme is a
 * per-account setting that can disagree with the OS `prefers-color-scheme`
 * (light GitHub on a dark Mac is a common combination), so reading the
 * rendered page is the only way to be sure the paddle, ball, HUD and
 * result banner stay legible. Falls back to the bundled themes when the
 * page doesn't give a usable answer.
 */
function readPageColors(doc: Document, view: Window): PageColors | null {
  if (typeof view.getComputedStyle !== "function") return null;

  const style = view.getComputedStyle(doc.body);
  const foreground = style.color;
  const background = style.backgroundColor;
  const transparent = !background || background === "transparent" || background.startsWith("rgba(0, 0, 0, 0)");

  if (!foreground || transparent) return null;
  return { foreground, background };
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
  const pageColors = readPageColors(doc, view);
  const foreground = pageColors?.foreground ?? themeBase.paddleColor;
  const levelColors = readLevelColors([...grassCells], view) ?? themeBase.colors;
  const overlayTheme: OverlayTheme = {
    levelColors,
    paddleColor: foreground,
    ballColor: foreground,
    textColor: foreground,
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

  /**
   * `game.movePaddle` clamps internally, but `paddleX` is our own cursor and
   * has to be clamped too: the mousemove listener is on `window`, so on a
   * wide monitor it is routinely far outside the ~692px board, and an
   * unclamped value would need dozens of arrow presses to walk back into
   * range before the paddle moved at all.
   *
   * The clamp is to the range the paddle's *centre* can occupy, not to the
   * canvas: clamping to `[0, canvasWidth]` still leaves the cursor up to
   * half a paddle beyond where the paddle can go, which on a narrow board
   * silently swallows the first arrow press or two.
   */
  function setPaddleX(x: number): void {
    const half = config.paddleWidth / 2;
    paddleX = Math.min(Math.max(x, half), config.canvasWidth - half);
    game.movePaddle(paddleX);
  }

  function handleMouseMove(event: MouseEvent): void {
    setPaddleX(canvasXFromClientX(event.clientX));
  }

  function handleTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch) return;
    setPaddleX(canvasXFromClientX(touch.clientX));
  }

  function handleCanvasClick(): void {
    game.launch();
  }

  /** True while the user is typing into GitHub's own UI (search, comment box, ...). */
  function isTextEntry(target: EventTarget | null): boolean {
    // `view` is typed as a bare `Window`, which doesn't carry the global
    // constructors; the intersection is the standard way to reach them
    // without an `any`.
    const elementCtor = (view as Window & typeof globalThis).HTMLElement;
    if (typeof elementCtor !== "function" || !(target instanceof elementCtor)) return false;

    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Once the result banner is up the game no longer owns the keyboard —
    // swallowing Space here would stop the user pressing its buttons with
    // the keyboard (same fix as the web app's session 2 review L1).
    if (game.state === "gameOver" || game.state === "clear") return;
    // The listener is on `window`, so without this the game would eat every
    // space typed into GitHub's search box while a round is running.
    if (isTextEntry(event.target)) return;

    if (event.code === "Space") {
      event.preventDefault();
      game.launch();
      return;
    }
    if (event.code === "ArrowLeft") {
      setPaddleX(paddleX - ARROW_STEP_PX);
    } else if (event.code === "ArrowRight") {
      setPaddleX(paddleX + ARROW_STEP_PX);
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
    // Page colours, not hardcoded white-on-default: on GitHub's dark theme a
    // white banner would carry near-white inherited text and be unreadable.
    banner.style.background = pageColors?.background ?? "rgba(255, 255, 255, 0.92)";
    banner.style.color = foreground;
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
 * Idempotent: a second call while a session is live returns that session
 * (`autoMount` below is what drives the repeat calls).
 */
export function mount(doc: Document, view: Window): Session | null {
  if (activeSession) return activeSession;

  const maybeTable = findGrassTable(doc);
  if (!maybeTable) return null;
  // See the identical `overlay` re-binding in createGameRuntime: keeps the
  // non-null narrowing available inside startGame's closure below.
  const table: HTMLElement = maybeTable;

  const container = findGraphContainer(doc) ?? table.parentElement ?? doc.body;

  // A stale button can outlive its session — a Turbo restoration visit
  // replays a snapshot cached mid-game. Replace it rather than reuse it:
  // reusing would leave the previous session's click handler attached, so
  // one click would start two games and 「やめる」 would only stop one.
  doc.getElementById(BUTTON_ID)?.remove();

  const launchButton = doc.createElement("button");
  launchButton.type = "button";
  launchButton.id = BUTTON_ID;
  launchButton.className = "btn btn-sm";
  launchButton.textContent = BUTTON_LABEL_IDLE;
  container.appendChild(launchButton);

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

    if (geometry.cols !== grid.weeks.length) {
      // These are equal by construction (both are the same contiguous run of
      // days folded on the same weekday boundary). If GitHub ever breaks that
      // — a gap in the dates, a column the grid doesn't know about — the
      // bricks silently stop lining up with the grass, so say so out loud.
      console.warn(
        `kusakuzushi: grass has ${geometry.cols} columns but the grid folded to ${grid.weeks.length}; bricks may not line up.`,
      );
    }

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
    activeSession = null;
    activeButton = null;
  }

  activeSession = { stop };
  activeButton = launchButton;
  return activeSession;
}

export type AutoMount = { stop(): void };

/**
 * Keeps the extension mounted across the page's whole lifecycle.
 *
 * The graph is NOT in the profile page's initial HTML: GitHub streams it in
 * with an `<include-fragment>` that resolves well after `document_idle`, so
 * a content script that only tries once at startup finds no table and gives
 * up forever. The same is true after a Turbo navigation — `turbo:load`
 * fires before the fragment lands. So every entry point below re-runs
 * `mount`, and when it comes up empty we watch the DOM until the grass
 * actually appears.
 */
export function autoMount(doc: Document, view: Window): AutoMount {
  let observer: MutationObserver | null = null;

  function unwatch(): void {
    observer?.disconnect();
    observer = null;
  }

  /**
   * A live session owns a button that is still in the document. Checking the
   * DOM rather than trusting `activeSession` alone matters because the
   * button's container IS the include-fragment's root element: a re-resolved
   * fragment (year filter, "show private contributions") replaces it and
   * takes the button with it, without firing any Turbo event.
   */
  function isMounted(): boolean {
    return activeSession !== null && activeButton?.isConnected === true;
  }

  function sync(): void {
    if (isMounted()) return;
    // The session's DOM is gone; drop it so `mount` doesn't short-circuit.
    activeSession?.stop();
    mount(doc, view);
  }

  /** Only profile pages ever grow a contribution graph, and the content script runs on all of github.com. */
  function looksLikeProfilePage(): boolean {
    return view.location.pathname.split("/").filter((segment) => segment.length > 0).length === 1;
  }

  function tryMount(): void {
    sync();

    if (observer || !looksLikeProfilePage()) return;

    const observerCtor = (view as Window & typeof globalThis).MutationObserver;
    if (typeof observerCtor !== "function") return;

    // Stays armed for the page's lifetime rather than disconnecting once
    // mounted, so a fragment that swaps the graph out from under us is
    // recovered from — `sync` returns immediately while the mount is intact,
    // so the steady-state cost is one `getElementById` per mutation batch.
    const watcher = new observerCtor(sync);
    watcher.observe(doc.documentElement, { childList: true, subtree: true });
    observer = watcher;
  }

  // `turbo:before-cache` fires *before* `turbo:before-render`, and it is the
  // one that matters: Turbo snapshots the DOM there for restoration visits.
  // Tearing down any later would cache the greyed-out grass and the overlay
  // canvas, and the user would meet them again on Back.
  function reset(): void {
    unwatch();
    activeSession?.stop();
  }

  // A bfcache restore replays the page with the button already removed by
  // `pagehide`, so `pageshow` has to put it back.
  function handlePageShow(): void {
    tryMount();
  }

  doc.addEventListener("turbo:load", tryMount);
  doc.addEventListener("turbo:before-cache", reset);
  doc.addEventListener("turbo:before-render", reset);
  view.addEventListener("pagehide", reset);
  view.addEventListener("pageshow", handlePageShow);

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", tryMount);
  } else {
    tryMount();
  }

  return {
    stop(): void {
      reset();
      doc.removeEventListener("turbo:load", tryMount);
      doc.removeEventListener("turbo:before-cache", reset);
      doc.removeEventListener("turbo:before-render", reset);
      doc.removeEventListener("DOMContentLoaded", tryMount);
      view.removeEventListener("pagehide", reset);
      view.removeEventListener("pageshow", handlePageShow);
    },
  };
}
