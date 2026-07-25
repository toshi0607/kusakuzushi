/**
 * The touch rail: a strip directly under the board that maps a finger's
 * horizontal position onto the paddle track 1:1.
 *
 * On a phone the board is only ~170px tall, so steering by dragging on the
 * canvas itself buries the ball and the paddle under the thumb — and a tap
 * there launches immediately, before the player can aim. The rail moves the
 * touch surface out of the picture: it is exactly as wide as the canvas, so
 * the paddle always lands under the finger, and the ball leaves the paddle
 * only when the finger lifts.
 */

export type PaddleRailHandlers = {
  /** Paddle centre, in canvas coordinates. */
  onMove: (canvasX: number) => void;
  /** Fired when the finger lifts — "aim while held, launch on release". */
  onLaunch: () => void;
};

export type PaddleRailOptions = PaddleRailHandlers & {
  canvasWidth: number;
  paddleWidth: number;
};

export type PaddleRail = {
  element: HTMLElement;
  /** Mirrors the paddle's real centre (canvas coordinates) onto the handle. */
  setPaddleCenter: (canvasX: number) => void;
  /**
   * Turns the rail off once the round is over. The frame loop stops on
   * gameOver/clear, so a rail that still accepted touches would move a
   * paddle nobody repaints — the handle would sit still under the finger
   * and read as broken.
   */
  setActive: (active: boolean) => void;
  destroy: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createPaddleRail(options: PaddleRailOptions): PaddleRail {
  const { canvasWidth, paddleWidth, onMove, onLaunch } = options;

  const element = document.createElement("div");
  element.className = "paddle-rail";
  // A touch-only surface with no keyboard path: arrow keys already steer the
  // paddle, so announcing a gesture a screen-reader user cannot aim would
  // only add noise.
  element.setAttribute("aria-hidden", "true");

  const handle = document.createElement("div");
  handle.className = "paddle-rail-handle";
  handle.style.width = `${(paddleWidth / canvasWidth) * 100}%`;
  element.appendChild(handle);

  const hint = document.createElement("span");
  hint.className = "paddle-rail-hint";
  hint.textContent = "触れた位置にパドルが動き、離すと発射";
  element.appendChild(hint);

  // The id of the finger that owns the rail, or null when nobody is
  // steering. A plain boolean would let a *second* finger — the one the
  // player rests on the board — end the first finger's drag, launch the
  // ball and leave the thumb still pressed but steering nothing.
  let activePointerId: number | null = null;
  let active = true;
  let lastHandlePercent = -1;

  /** Null when the rail has no width to map onto (hidden or detached). */
  function canvasXFromClientX(clientX: number): number | null {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return null;
    return clamp(((clientX - rect.left) / rect.width) * canvasWidth, 0, canvasWidth);
  }

  function steer(clientX: number): void {
    const canvasX = canvasXFromClientX(clientX);
    if (canvasX === null) return;
    onMove(canvasX);
  }

  function ownsPointer(event: PointerEvent): boolean {
    return activePointerId !== null && event.pointerId === activePointerId;
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!active || activePointerId !== null) return;
    // Keeps the browser from turning the drag into a page scroll or a
    // text selection on touch (`touch-action: none` covers scrolling, but
    // not the long-press selection gesture).
    event.preventDefault();
    activePointerId = event.pointerId;
    element.dataset.touched = "true";
    steer(event.clientX);
  }

  // Drag tracking lives on `window`, not on the rail: a finger or cursor that
  // wanders off the strip mid-swipe must keep steering. Touch pointers get
  // implicit capture, but mouse pointers do not — and `setPointerCapture` is
  // absent in jsdom, so window listeners keep one code path for both.
  function handlePointerMove(event: PointerEvent): void {
    if (!ownsPointer(event)) return;
    steer(event.clientX);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!ownsPointer(event)) return;
    activePointerId = null;
    steer(event.clientX);
    onLaunch();
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (!ownsPointer(event)) return;
    activePointerId = null;
  }

  element.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);

  return {
    element,
    setPaddleCenter(canvasX: number): void {
      // The paddle's centre can only live inside the track, and the handle
      // is centred on it — clamping to [0, canvasWidth] instead would hang
      // half the handle outside the rail.
      const half = paddleWidth / 2;
      const percent = (clamp(canvasX, half, canvasWidth - half) / canvasWidth) * 100;
      // The rail is repainted every frame; skip sub-pixel churn.
      if (Math.abs(percent - lastHandlePercent) < 0.05) return;
      lastHandlePercent = percent;
      handle.style.left = `${percent}%`;
    },
    setActive(next: boolean): void {
      if (next === active) return;
      active = next;
      activePointerId = null;
      if (next) {
        delete element.dataset.inactive;
      } else {
        element.dataset.inactive = "true";
      }
    },
    destroy(): void {
      element.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      element.remove();
    },
  };
}
