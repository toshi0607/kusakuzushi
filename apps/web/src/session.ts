/**
 * Owns one play-through: canvas + input + the requestAnimationFrame loop,
 * plus the ready/ballLost launch guide and the gameOver/clear result
 * overlay. Mounts into `container` and returns a `destroy` cleanup.
 */

import type { ContributionGrid, GameState, Theme } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, Game, MAX_FRAME_DT, render } from "@kusakuzushi/core";

import { buildIntentUrl, saveCanvasImage } from "./share";

/** Paddle speed, in px/sec, while an arrow key is held. */
const KEY_MOVE_SPEED_PX_PER_SEC = 480;

type ResultState = Extract<GameState, "gameOver" | "clear">;

export type SessionHandlers = {
  /** Invoked when the "もう一回" button is clicked. */
  onRestart: () => void;
};

/** Sum of `count` over bricks the player has already destroyed. */
function harvestedCount(game: Game): number {
  let sum = 0;
  for (const brick of game.liveBricks) {
    if (!brick.alive) sum += brick.count;
  }
  return sum;
}

export function createSession(
  container: HTMLElement,
  username: string,
  grid: ContributionGrid,
  getTheme: () => Theme,
  handlers: SessionHandlers,
): () => void {
  const game = new Game(grid);

  const wrapper = document.createElement("div");
  wrapper.className = "play-area";

  const canvas = document.createElement("canvas");
  canvas.width = DEFAULT_CONFIG.canvasWidth;
  canvas.height = DEFAULT_CONFIG.canvasHeight;
  canvas.className = "game-canvas";
  wrapper.appendChild(canvas);

  const guide = document.createElement("div");
  guide.className = "overlay guide-overlay";
  guide.textContent = "クリック / Space で発射";
  guide.hidden = true;
  wrapper.appendChild(guide);

  const result = document.createElement("div");
  result.className = "overlay result-overlay";
  result.hidden = true;
  wrapper.appendChild(result);

  container.appendChild(wrapper);

  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let paddleX = DEFAULT_CONFIG.canvasWidth / 2;
  const heldKeys = new Set<string>();
  let lastResultState: ResultState | null = null;

  function canvasXFromClientX(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    return (clientX - rect.left) * scaleX;
  }

  function handlePointerMove(event: PointerEvent): void {
    paddleX = canvasXFromClientX(event.clientX);
    game.movePaddle(paddleX);
  }

  function handlePointerDown(): void {
    game.launch();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.code === "Space") {
      // On the result screen, Space must keep activating the focused
      // button — swallowing it here would break keyboard access to
      // 「画像を保存」/「もう一回」.
      if (game.state === "gameOver" || game.state === "clear") {
        return;
      }
      event.preventDefault();
      game.launch();
      return;
    }
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      heldKeys.add(event.code);
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    heldKeys.delete(event.code);
  }

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  function applyKeyboardMovement(dt: number): void {
    if (heldKeys.size === 0) return;
    let delta = 0;
    if (heldKeys.has("ArrowLeft")) delta -= KEY_MOVE_SPEED_PX_PER_SEC * dt;
    if (heldKeys.has("ArrowRight")) delta += KEY_MOVE_SPEED_PX_PER_SEC * dt;
    if (delta === 0) return;
    paddleX = Math.min(Math.max(paddleX + delta, 0), DEFAULT_CONFIG.canvasWidth);
    game.movePaddle(paddleX);
  }

  function renderResult(state: ResultState): void {
    result.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = state === "clear" ? "🌱 完全刈り取り!" : "ゲームオーバー";
    result.appendChild(heading);

    const pct = grid.total > 0 ? Math.floor((harvestedCount(game) / grid.total) * 100) : 0;

    const stats = document.createElement("p");
    stats.className = "result-stats";
    stats.textContent = `スコア: ${game.score} / 刈り取り率: ${pct}%`;
    result.appendChild(stats);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    const shareLink = document.createElement("a");
    shareLink.className = "share-button";
    shareLink.href = buildIntentUrl(username, grid.total, pct, game.score);
    shareLink.target = "_blank";
    shareLink.rel = "noopener noreferrer";
    shareLink.textContent = "Xで共有";
    actions.appendChild(shareLink);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "画像を保存";
    saveButton.addEventListener("click", () => {
      saveButton.disabled = true;
      saveCanvasImage(canvas, username)
        .catch(() => {
          saveButton.textContent = "保存に失敗しました";
        })
        .finally(() => {
          saveButton.disabled = false;
        });
    });
    actions.appendChild(saveButton);

    const restartButton = document.createElement("button");
    restartButton.type = "button";
    restartButton.textContent = "もう一回";
    restartButton.addEventListener("click", () => {
      handlers.onRestart();
    });
    actions.appendChild(restartButton);

    result.appendChild(actions);
  }

  function updateOverlay(): void {
    const state = game.state;
    guide.hidden = !(state === "ready" || state === "ballLost");

    if (state === "gameOver" || state === "clear") {
      if (lastResultState !== state) {
        lastResultState = state;
        renderResult(state);
      }
      result.hidden = false;
    } else {
      lastResultState = null;
      result.hidden = true;
    }
  }

  let running = true;
  let lastTimeMs = performance.now();
  let rafId = 0;

  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min(Math.max((now - lastTimeMs) / 1000, 0), MAX_FRAME_DT);
    lastTimeMs = now;

    applyKeyboardMovement(dt);
    game.update(dt);
    render(ctx, game, getTheme());
    updateOverlay();

    // Terminal states never leave without a full session restart
    // (onRestart builds a new session), so stop the loop instead of
    // redrawing a static frame at 60fps under the result overlay.
    if (game.state === "gameOver" || game.state === "clear") {
      return;
    }

    rafId = window.requestAnimationFrame(frame);
  }

  rafId = window.requestAnimationFrame(frame);

  return function destroy(): void {
    running = false;
    window.cancelAnimationFrame(rafId);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    wrapper.remove();
  };
}
