/**
 * アトラクトモード: トップページで AI 操作のパドルがデモグリッドを延々と
 * 崩し続ける(アーケードの客寄せ画面)。入力は受け付けない。
 *
 * ライフサイクル: 生育アニメ(reveal)→ 自動発射 → autopilot。落球は自動で
 * 再発射し、gameOver / clear でグリッドを作り直して最初から。
 * prefers-reduced-motion では静止した草グリッドだけを描く。
 */

import type { Theme } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, Game, MAX_FRAME_DT, render } from "@kusakuzushi/core";

import { buildDemoGrid } from "./demo-grid";

/** 生育アニメの長さ。GitHub のグラフ読込の残像とつながる速さにする。 */
const REVEAL_DURATION_MS = 700;
/** 生育完了から発射までの間。 */
const LAUNCH_DELAY_MS = 500;
/** 落球から再発射までの間。 */
const RELAUNCH_DELAY_MS = 1200;
/** 完璧すぎない追従にするための揺らぎ幅(px)と周期(ms)。 */
const WOBBLE_AMPLITUDE_PX = 18;
const WOBBLE_PERIOD_MS = 800;
/** autopilot のパドル最大速度(px/sec)。人間のマウス相当に抑える。 */
const AUTOPILOT_SPEED_PX_PER_SEC = 620;

export function createAttract(container: HTMLElement, getTheme: () => Theme): () => void {
  const wrapper = document.createElement("div");
  wrapper.className = "play-area demo-area";

  const canvas = document.createElement("canvas");
  canvas.width = DEFAULT_CONFIG.canvasWidth;
  canvas.height = DEFAULT_CONFIG.canvasHeight;
  canvas.className = "game-canvas demo-canvas";
  canvas.setAttribute("aria-hidden", "true");
  wrapper.appendChild(canvas);

  const label = document.createElement("span");
  label.className = "demo-label";
  label.textContent = "DEMO PLAY";
  wrapper.appendChild(label);

  container.appendChild(wrapper);

  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    wrapper.remove();
    return () => {};
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    render(ctx, new Game(buildDemoGrid()), getTheme(), { hud: false });
    return function destroy(): void {
      wrapper.remove();
    };
  }

  let game = new Game(buildDemoGrid());
  let revealStartMs = performance.now();
  let paddleX = DEFAULT_CONFIG.canvasWidth / 2;
  let launchAtMs: number | null = revealStartMs + REVEAL_DURATION_MS + LAUNCH_DELAY_MS;

  function restart(now: number): void {
    game = new Game(buildDemoGrid());
    revealStartMs = now;
    paddleX = DEFAULT_CONFIG.canvasWidth / 2;
    launchAtMs = now + REVEAL_DURATION_MS + LAUNCH_DELAY_MS;
  }

  function autopilot(now: number, dt: number): void {
    const wobble = Math.sin(now / WOBBLE_PERIOD_MS) * WOBBLE_AMPLITUDE_PX;
    const target = game.ballState.x + wobble;
    const maxStep = AUTOPILOT_SPEED_PX_PER_SEC * dt;
    const delta = Math.min(Math.max(target - paddleX, -maxStep), maxStep);
    paddleX += delta;
    game.movePaddle(paddleX);
  }

  let running = true;
  let lastTimeMs = performance.now();
  let rafId = 0;

  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min(Math.max((now - lastTimeMs) / 1000, 0), MAX_FRAME_DT);
    lastTimeMs = now;

    const reveal = Math.min((now - revealStartMs) / REVEAL_DURATION_MS, 1);

    if (game.state === "gameOver" || game.state === "clear") {
      restart(now);
    } else if (game.state === "ready" || game.state === "ballLost") {
      if (launchAtMs === null) {
        launchAtMs = now + RELAUNCH_DELAY_MS;
      } else if (now >= launchAtMs) {
        game.launch();
        launchAtMs = null;
      }
    }

    if (game.state === "playing") {
      autopilot(now, dt);
    }

    game.update(dt);
    render(ctx, game, getTheme(), { reveal, hud: false });

    rafId = window.requestAnimationFrame(frame);
  }

  rafId = window.requestAnimationFrame(frame);

  return function destroy(): void {
    running = false;
    window.cancelAnimationFrame(rafId);
    wrapper.remove();
  };
}
