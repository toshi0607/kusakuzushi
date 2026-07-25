/**
 * @vitest-environment jsdom
 *
 * jsdom 25 has neither `PointerEvent` nor `setPointerCapture` (実測
 * 2026-07-25), so the drags below are driven with `MouseEvent`s carrying a
 * `pointerdown`/`pointermove`/`pointerup` type — which is exactly why the
 * rail tracks drags with window listeners instead of pointer capture.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaddleRail } from "./paddle-rail";

const CANVAS_WIDTH = 960;
const PADDLE_WIDTH = 80;

/** A 480px-wide rail at x=0 — half the canvas resolution, so 1px = 2 canvas px. */
function mountRail() {
  const onMove = vi.fn<(canvasX: number) => void>();
  const onLaunch = vi.fn<() => void>();
  const rail = createPaddleRail({
    canvasWidth: CANVAS_WIDTH,
    paddleWidth: PADDLE_WIDTH,
    onMove,
    onLaunch,
  });
  document.body.appendChild(rail.element);
  rail.element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 480, bottom: 56, width: 480, height: 56, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { rail, onMove, onLaunch };
}

/** jsdom has no PointerEvent, so `pointerId` is grafted onto a MouseEvent. */
function pointer(type: string, clientX: number, pointerId = 1): MouseEvent {
  const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

describe("createPaddleRail", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("maps a touch on the rail onto the proportional canvas x", () => {
    // #given
    const { rail, onMove } = mountRail();

    // #when — 1/4 across a 480px rail
    rail.element.dispatchEvent(pointer("pointerdown", 120));

    // #then
    expect(onMove).toHaveBeenCalledWith(240);
  });

  it("clamps a drag that runs past either end of the rail", () => {
    // #given
    const { rail, onMove } = mountRail();

    // #when
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", -300));
    window.dispatchEvent(pointer("pointermove", 5000));

    // #then
    expect(onMove).toHaveBeenNthCalledWith(2, 0);
    expect(onMove).toHaveBeenNthCalledWith(3, CANVAS_WIDTH);
  });

  it("keeps steering after the finger leaves the rail, but not before it lands", () => {
    // #given
    const { rail, onMove } = mountRail();

    // #when — a move with no preceding press must be ignored
    window.dispatchEvent(pointer("pointermove", 240));
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 360));

    // #then
    expect(onMove.mock.calls).toEqual([[240], [720]]);
  });

  it("launches on release, never while the finger is still down", () => {
    // #given
    const { rail, onLaunch } = mountRail();

    // #when
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointermove", 300));
    expect(onLaunch).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointerup", 300));

    // #then
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("does not launch on a release that belongs to another element", () => {
    // #given
    const { onLaunch } = mountRail();

    // #when — the player lifted a finger somewhere else on the page
    window.dispatchEvent(pointer("pointerup", 300));

    // #then
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("ignores a second finger while one is already steering", () => {
    // #given — the thumb holds the rail, aiming
    const { rail, onMove, onLaunch } = mountRail();
    rail.element.dispatchEvent(pointer("pointerdown", 120, 1));
    onMove.mockClear();

    // #when — the other hand touches the board and lifts again
    rail.element.dispatchEvent(pointer("pointerdown", 400, 2));
    window.dispatchEvent(pointer("pointermove", 400, 2));
    window.dispatchEvent(pointer("pointerup", 400, 2));

    // #then — the thumb keeps the rail, and nothing was launched for it
    expect(onMove).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();

    // #when
    window.dispatchEvent(pointer("pointermove", 360, 1));

    // #then
    expect(onMove).toHaveBeenCalledWith(720);
  });

  it("ignores a cancel that belongs to another pointer", () => {
    // #given
    const { rail, onMove } = mountRail();
    rail.element.dispatchEvent(pointer("pointerdown", 120, 1));

    // #when
    window.dispatchEvent(pointer("pointercancel", 400, 2));
    window.dispatchEvent(pointer("pointermove", 360, 1));

    // #then
    expect(onMove).toHaveBeenLastCalledWith(720);
  });

  it("frees the rail when the browser takes the pointer away without a release", () => {
    // #given — e.g. a mouse button released outside the window
    const { rail, onMove, onLaunch } = mountRail();
    rail.element.dispatchEvent(pointer("pointerdown", 120));

    // #when
    rail.element.dispatchEvent(pointer("lostpointercapture", 120));

    // #then — the stale drag is gone, and the rail answers the next finger
    window.dispatchEvent(pointer("pointermove", 360));
    window.dispatchEvent(pointer("pointerup", 360));
    expect(onLaunch).not.toHaveBeenCalled();
    onMove.mockClear();
    rail.element.dispatchEvent(pointer("pointerdown", 360));
    expect(onMove).toHaveBeenCalledWith(720);
  });

  it("reports whether it is on screen, so the board knows who owns touch", () => {
    // #given
    const { rail } = mountRail();

    // #then
    expect(rail.isVisible()).toBe(true);

    // #when — hidden by the media query
    rail.element.getBoundingClientRect = () => ({ width: 0, left: 0 }) as DOMRect;

    // #then
    expect(rail.isVisible()).toBe(false);
  });

  it("ignores pointers while the rail has no width to map onto", () => {
    // #given — hidden by the media query, or detached
    const { rail, onMove } = mountRail();
    rail.element.getBoundingClientRect = () => ({ width: 0, left: 0 }) as DOMRect;

    // #when
    rail.element.dispatchEvent(pointer("pointerdown", 120));

    // #then — no move at all, rather than a jump to the left wall
    expect(onMove).not.toHaveBeenCalled();
  });

  it("stops steering when the browser cancels the pointer", () => {
    // #given
    const { rail, onMove, onLaunch } = mountRail();

    // #when
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointercancel", 120));
    window.dispatchEvent(pointer("pointermove", 360));
    window.dispatchEvent(pointer("pointerup", 360));

    // #then
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("places the handle at the paddle's share of the track", () => {
    // #given
    const { rail } = mountRail();
    const handle = rail.element.querySelector<HTMLElement>(".paddle-rail-handle");

    // #when
    rail.setPaddleCenter(CANVAS_WIDTH / 4);

    // #then — width mirrors the paddle, left mirrors its centre
    expect(handle?.style.width).toBe(`${(PADDLE_WIDTH / CANVAS_WIDTH) * 100}%`);
    expect(handle?.style.left).toBe("25%");
  });

  it("keeps the handle inside the rail when handed an out-of-track centre", () => {
    // #given
    const { rail } = mountRail();
    const handle = rail.element.querySelector<HTMLElement>(".paddle-rail-handle");

    // #when
    rail.setPaddleCenter(CANVAS_WIDTH * 2);

    // #then — the handle is centred on this point and 8.33% wide, so its
    // right edge lands exactly on the rail's right edge
    const half = ((PADDLE_WIDTH / CANVAS_WIDTH) * 100) / 2;
    expect(Number.parseFloat(handle?.style.left ?? "")).toBeCloseTo(100 - half, 6);
  });

  it("skips repaints that would not move the handle a visible amount", () => {
    // #given
    const { rail } = mountRail();
    const handle = rail.element.querySelector<HTMLElement>(".paddle-rail-handle");
    rail.setPaddleCenter(480);
    const settled = handle?.style.left;

    // #when — sub-pixel drift, as the frame loop feeds it every frame
    rail.setPaddleCenter(480.1);

    // #then
    expect(handle?.style.left).toBe(settled);

    // #when
    rail.setPaddleCenter(500);

    // #then
    expect(handle?.style.left).not.toBe(settled);
  });

  it("stops responding while inactive and picks up again when reactivated", () => {
    // #given
    const { rail, onMove, onLaunch } = mountRail();

    // #when — the round ended: the board no longer repaints
    rail.setActive(false);
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    window.dispatchEvent(pointer("pointerup", 120));

    // #then
    expect(rail.element.dataset.inactive).toBe("true");
    expect(onMove).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();

    // #when
    rail.setActive(true);
    rail.element.dispatchEvent(pointer("pointerdown", 120));

    // #then
    expect(rail.element.dataset.inactive).toBeUndefined();
    expect(onMove).toHaveBeenCalledWith(240);
  });

  it("drops an in-flight drag when it goes inactive mid-swipe", () => {
    // #given
    const { rail, onMove, onLaunch } = mountRail();
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    onMove.mockClear();

    // #when — the last ball was lost while the finger was still down
    rail.setActive(false);
    window.dispatchEvent(pointer("pointermove", 360));
    window.dispatchEvent(pointer("pointerup", 360));

    // #then
    expect(onMove).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("drops the hint once the rail has been used", () => {
    // #given
    const { rail } = mountRail();
    expect(rail.element.dataset.touched).toBeUndefined();

    // #when
    rail.element.dispatchEvent(pointer("pointerdown", 120));

    // #then
    expect(rail.element.dataset.touched).toBe("true");
  });

  it("goes fully inert after destroy", () => {
    // #given
    const { rail, onMove, onLaunch } = mountRail();
    rail.element.dispatchEvent(pointer("pointerdown", 120));
    onMove.mockClear();

    // #when
    rail.destroy();
    window.dispatchEvent(pointer("pointermove", 360));
    window.dispatchEvent(pointer("pointerup", 360));

    // #then
    expect(onMove).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(document.body.querySelector(".paddle-rail")).toBeNull();
  });
});
