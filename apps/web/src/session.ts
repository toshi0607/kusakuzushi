/**
 * Owns one play-through: canvas + input + the requestAnimationFrame loop,
 * plus the ready/ballLost launch guide and the gameOver/clear result
 * overlay. Mounts into `container` and returns a `destroy` cleanup.
 */

import type { ContributionGrid, GameState, Theme } from "@kusakuzushi/core";
import {
  buildIntentUrl,
  clearMessageFor,
  DEFAULT_CONFIG,
  Game,
  harvestPercentage,
  MAX_FRAME_DT,
  render,
} from "@kusakuzushi/core";

import { createPaddleRail } from "./paddle-rail";
import { saveResultImage } from "./share";
import { watchTheme } from "./theme";

/** Paddle speed, in px/sec, while an arrow key is held. */
const KEY_MOVE_SPEED_PX_PER_SEC = 480;

/** 「草の生育」アニメの長さ(DESIGN-VISUAL §4。attract.ts と同じ値)。 */
const REVEAL_DURATION_MS = 700;

type ResultState = Extract<GameState, "gameOver" | "clear">;

export type SessionHandlers = {
  /** Invoked when the "もう一回" button is clicked. */
  onRestart: () => void;
};

export function createSession(
  container: HTMLElement,
  username: string,
  grid: ContributionGrid,
  getTheme: () => Theme,
  handlers: SessionHandlers,
): () => void {
  const game = new Game(grid);

  // The board and the touch rail move together as one block: the rail is
  // only meaningful directly under the paddle track it mirrors.
  const stack = document.createElement("div");
  stack.className = "play-stack";

  const wrapper = document.createElement("div");
  wrapper.className = "play-area";

  const canvas = document.createElement("canvas");
  canvas.width = DEFAULT_CONFIG.canvasWidth;
  canvas.height = DEFAULT_CONFIG.canvasHeight;
  canvas.className = "game-canvas";
  wrapper.appendChild(canvas);

  // Touch devices have neither a click nor a Space key, and the board
  // ignores touches — so point at the one surface that does answer them.
  // The rail carries its own label for the gesture itself.
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  const guide = document.createElement("div");
  guide.className = "overlay guide-overlay";
  guide.textContent = coarsePointer ? "下のバーで発射" : "クリック / Space で発射";
  guide.hidden = true;
  wrapper.appendChild(guide);

  const result = document.createElement("div");
  result.className = "overlay result-overlay";
  result.hidden = true;
  wrapper.appendChild(result);

  stack.appendChild(wrapper);
  container.appendChild(stack);

  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    throw new Error("2D描画コンテキストを取得できませんでした");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let paddleX = DEFAULT_CONFIG.canvasWidth / 2;
  const heldKeys = new Set<string>();
  let lastResultState: ResultState | null = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealStartMs = performance.now();

  /**
   * Holds `paddleX` inside the paddle centre's own range rather than
   * [0, canvasWidth]. `paddleX` is the cursor the arrow keys move from, so
   * a value the paddle can never reach would swallow the first key presses.
   */
  function clampPaddleX(x: number): number {
    const half = game.paddleState.width / 2;
    return Math.min(Math.max(x, half), DEFAULT_CONFIG.canvasWidth - half);
  }

  function canvasXFromClientX(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    return clampPaddleX((clientX - rect.left) * scaleX);
  }

  /**
   * True when the rail is on screen and should own touch instead of the
   * board: a finger on the board hides the ball, and a tap that misses the
   * rail by a few pixels would fire before the player has aimed.
   *
   * Asking the rail — rather than re-testing `(pointer: coarse)` here — is
   * what keeps the two in step. A touchscreen laptop reports `pointer: fine`,
   * so the stylesheet leaves the rail hidden; if this said "touch" instead,
   * that machine would have no touch surface at all.
   */
  function railOwnsTouch(event: PointerEvent): boolean {
    return event.pointerType === "touch" && rail.isVisible();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (railOwnsTouch(event)) return;
    paddleX = canvasXFromClientX(event.clientX);
    game.movePaddle(paddleX);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (railOwnsTouch(event)) return;
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

  const rail = createPaddleRail({
    canvasWidth: DEFAULT_CONFIG.canvasWidth,
    paddleWidth: game.paddleState.width,
    onMove: (canvasX) => {
      paddleX = clampPaddleX(canvasX);
      game.movePaddle(paddleX);
    },
    onLaunch: () => {
      game.launch();
    },
  });
  stack.appendChild(rail.element);

  function applyKeyboardMovement(dt: number): void {
    if (heldKeys.size === 0) return;
    let delta = 0;
    if (heldKeys.has("ArrowLeft")) delta -= KEY_MOVE_SPEED_PX_PER_SEC * dt;
    if (heldKeys.has("ArrowRight")) delta += KEY_MOVE_SPEED_PX_PER_SEC * dt;
    if (delta === 0) return;
    paddleX = clampPaddleX(paddleX + delta);
    game.movePaddle(paddleX);
  }

  /**
   * 共有カード用の盤面。画面の canvas をそのまま渡すと HUD(SCORE / LIFE)が
   * 焼き込まれ、カードのキャプションと同じ数字が二重に出る(DESIGN-VISUAL §8)。
   * 描画コンテキストが取れない環境では画面の canvas で妥協する — HUD が二重に
   * 写るほうが、画像が保存できないよりましなので。
   */
  function boardSnapshotForCard(): HTMLCanvasElement {
    const snapshot = document.createElement("canvas");
    snapshot.width = DEFAULT_CONFIG.canvasWidth;
    snapshot.height = DEFAULT_CONFIG.canvasHeight;
    const snapshotCtx = snapshot.getContext("2d");
    if (!snapshotCtx) return canvas;
    render(snapshotCtx, game, getTheme(), { reveal: 1, hud: false });
    return snapshot;
  }

  function renderResult(state: ResultState): void {
    result.replaceChildren();

    // クリア時は見出しの主役を煽り文に譲る。「完全刈り取り」はどのブロック
    // 崩しでも言える汎用の一言で、この盤面にしか無いのは「消したのは自分の
    // 1 年ぶんだ」と言い当てる側。見出し要素(h2)は状態を名乗ったまま残し、
    // 視覚の主役だけを入れ替える(読み上げの順序と意味は変えない)。
    const heading = document.createElement("h2");
    heading.textContent = state === "clear" ? "完全刈り取り" : "ゲームオーバー";
    if (state === "clear") heading.className = "result-state";
    result.appendChild(heading);

    // 煽り文は clear のときだけ。壊し残しがある gameOver では
    // 「全部消えました」系の文言がそのまま嘘になる。
    if (state === "clear") {
      const taunt = document.createElement("p");
      taunt.className = "result-taunt";
      taunt.textContent = clearMessageFor(grid.total);
      result.appendChild(taunt);
    }

    const pct = harvestPercentage(game, grid.total);

    const statGrid = document.createElement("div");
    statGrid.className = "result-stat-grid";
    const entries: Array<[string, string]> = [
      ["スコア", game.score.toLocaleString()],
      ["刈り取り率", `${pct}%`],
    ];
    for (const [labelText, valueText] of entries) {
      const stat = document.createElement("div");
      stat.className = "result-stat";
      const label = document.createElement("span");
      label.className = "result-stat-label";
      label.textContent = labelText;
      const value = document.createElement("span");
      value.className = "result-stat-value";
      value.textContent = valueText;
      stat.append(label, value);
      statGrid.appendChild(stat);
    }
    result.appendChild(statGrid);

    // 刈り取り率もプログレスバーではなく草セルの並びで語る(DESIGN-VISUAL §3)
    const HARVEST_CELLS = 18;
    const filled = Math.round((pct / 100) * HARVEST_CELLS);
    const bar = document.createElement("div");
    bar.className = "harvest-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `刈り取り率 ${pct}%`);
    for (let i = 0; i < HARVEST_CELLS; i++) {
      const cell = document.createElement("span");
      cell.className = i < filled ? "harvest-cell harvest-cell-filled" : "harvest-cell";
      bar.appendChild(cell);
    }
    result.appendChild(bar);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    const shareLink = document.createElement("a");
    shareLink.className = "share-button btn-primary";
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
      saveResultImage(boardSnapshotForCard(), username, {
        score: game.score,
        percentage: pct,
        cleared: state === "clear",
        taunt: state === "clear" ? clearMessageFor(grid.total) : null,
      })
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
    rail.setActive(state !== "gameOver" && state !== "clear");

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
    const reveal = reducedMotion ? 1 : Math.min((now - revealStartMs) / REVEAL_DURATION_MS, 1);
    render(ctx, game, getTheme(), { reveal });
    // Read the paddle back from the game rather than from `paddleX`: the
    // game clamps the centre to the track, so this is the only value that
    // actually matches what the player sees on the board.
    rail.setPaddleCenter(game.paddleState.x + game.paddleState.width / 2);
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

  // The loop stops on gameOver/clear, so an OS theme flip while the
  // result screen is up needs an explicit one-frame repaint.
  const unwatchTheme = watchTheme(() => {
    if (game.state === "gameOver" || game.state === "clear") {
      render(ctx, game, getTheme(), { reveal: 1 });
    }
  });

  return function destroy(): void {
    running = false;
    window.cancelAnimationFrame(rafId);
    unwatchTheme();
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    rail.destroy();
    stack.remove();
  };
}
