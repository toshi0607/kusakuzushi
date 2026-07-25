/**
 * @vitest-environment jsdom
 *
 * Covers the input wiring in `createSession`, which the rail's own unit
 * tests cannot see: which surface owns touch, and where the arrow keys
 * start from. jsdom has no 2D canvas context and no rAF worth the name, so
 * this stubs both — enough to run a real `Game` and read the paddle back
 * out of it. Mirrors the harness in apps/extension/src/game-runtime.test.ts.
 */

import type { ContributionGrid } from "@kusakuzushi/core";
import { DEFAULT_CONFIG, LIGHT_THEME, toGrid } from "@kusakuzushi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSession } from "./session";

/** A 480px-wide board at x=0: half the canvas resolution, so 1px = 2 canvas px. */
const BOARD = { left: 0, top: 0, width: 480, height: 240 };
const RAIL = { left: 0, top: 248, width: 480, height: 56 };
const PADDLE_HALF = DEFAULT_CONFIG.paddleWidth / 2;

type FakeRaf = { drain: (now: number) => void };

function stubCanvasContext(): void {
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
}

function stubRaf(): FakeRaf {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    callbacks.delete(id);
  });
  return {
    drain(now: number): void {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, cb] of pending) cb(now);
    },
  };
}

function rect(box: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * The rail's width is what tells the board whether to hand over touch, and
 * in jsdom every element measures 0 — so the rail is sized explicitly, and
 * `railVisible: false` reproduces a device whose media query left it hidden.
 */
function stubGeometry(railVisible: boolean): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("game-canvas")) return rect(BOARD);
    if (this.classList.contains("paddle-rail")) {
      return railVisible ? rect(RAIL) : rect({ ...RAIL, width: 0, height: 0 });
    }
    return rect({ left: 0, top: 0, width: 0, height: 0 });
  });
}

/** jsdom ships no `matchMedia` at all, so the whole thing is provided here. */
function stubMatchMedia(coarsePointer: boolean): void {
  const media = (query: string): MediaQueryList =>
    ({
      matches: query === "(pointer: coarse)" ? coarsePointer : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, "matchMedia", { value: media, configurable: true, writable: true });
}

function grassGrid(): ContributionGrid {
  const cells = Array.from({ length: 28 }, (_, i) => ({
    date: `2024-01-${String(i + 7).padStart(2, "0")}`,
    count: 1,
    level: 1 as const,
  }));
  return toGrid("toshi0607", cells);
}

type Harness = {
  container: HTMLElement;
  raf: FakeRaf;
  destroy: () => void;
};

function mountSession(options: { railVisible?: boolean; coarsePointer?: boolean } = {}): Harness {
  const { railVisible = true, coarsePointer = true } = options;
  stubCanvasContext();
  stubGeometry(railVisible);
  const raf = stubRaf();

  stubMatchMedia(coarsePointer);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const destroy = createSession(container, "toshi0607", grassGrid(), () => LIGHT_THEME, {
    onRestart: () => {},
  });
  raf.drain(0);
  return { container, raf, destroy };
}

function pointer(type: string, clientX: number, pointerType: string): MouseEvent {
  const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

/** The paddle's centre, read back out of what the session actually drew. */
function paddleCenter(container: HTMLElement): number {
  const handle = container.querySelector<HTMLElement>(".paddle-rail-handle");
  return (Number.parseFloat(handle?.style.left ?? "0") / 100) * DEFAULT_CONFIG.canvasWidth;
}

function isLaunched(container: HTMLElement): boolean {
  const guide = container.querySelector<HTMLElement>(".guide-overlay");
  return guide?.hidden === true;
}

describe("createSession input wiring", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    harness = null;
  });

  afterEach(() => {
    harness?.destroy();
    vi.restoreAllMocks();
  });

  it("hands touch to the rail: the board neither steers nor launches", () => {
    // #given
    harness = mountSession();
    const canvas = harness.container.querySelector<HTMLCanvasElement>(".game-canvas");

    // #when — a finger lands on the right half of the board
    canvas?.dispatchEvent(pointer("pointermove", 384, "touch"));
    canvas?.dispatchEvent(pointer("pointerdown", 384, "touch"));
    harness.raf.drain(16);

    // #then
    expect(paddleCenter(harness.container)).toBe(DEFAULT_CONFIG.canvasWidth / 2);
    expect(isLaunched(harness.container)).toBe(false);
  });

  it("keeps the board live for a mouse", () => {
    // #given
    harness = mountSession();
    const canvas = harness.container.querySelector<HTMLCanvasElement>(".game-canvas");

    // #when
    canvas?.dispatchEvent(pointer("pointermove", 120, "mouse"));
    canvas?.dispatchEvent(pointer("pointerdown", 120, "mouse"));
    harness.raf.drain(16);

    // #then
    expect(paddleCenter(harness.container)).toBeCloseTo(240, 5);
    expect(isLaunched(harness.container)).toBe(true);
  });

  it("keeps the board live for touch when the rail is not on screen", () => {
    // #given — a touchscreen laptop: `pointer: fine`, so the media query
    // leaves the rail hidden. Without this fallback, touch would be dead.
    harness = mountSession({ railVisible: false, coarsePointer: false });
    const canvas = harness.container.querySelector<HTMLCanvasElement>(".game-canvas");

    // #when
    canvas?.dispatchEvent(pointer("pointermove", 120, "touch"));
    canvas?.dispatchEvent(pointer("pointerdown", 120, "touch"));
    harness.raf.drain(16);

    // #then
    expect(isLaunched(harness.container)).toBe(true);
  });

  it("steers from the rail and launches when the finger lifts", () => {
    // #given
    harness = mountSession();
    const rail = harness.container.querySelector<HTMLElement>(".paddle-rail");

    // #when
    rail?.dispatchEvent(pointer("pointerdown", 360, "touch"));
    harness.raf.drain(16);

    // #then
    expect(paddleCenter(harness.container)).toBeCloseTo(720, 5);
    expect(isLaunched(harness.container)).toBe(false);

    // #when
    window.dispatchEvent(pointer("pointerup", 360, "touch"));
    harness.raf.drain(32);

    // #then
    expect(isLaunched(harness.container)).toBe(true);
  });

  it("names the surface that answers: the rail on touch, click/Space otherwise", () => {
    // #given / #when
    harness = mountSession({ coarsePointer: true });

    // #then
    expect(harness.container.querySelector(".guide-overlay")?.textContent).toBe("下のバーで発射");

    // #given / #when
    harness.destroy();
    vi.restoreAllMocks();
    harness = mountSession({ coarsePointer: false, railVisible: false });

    // #then
    expect(harness.container.querySelector(".guide-overlay")?.textContent).toBe(
      "クリック / Space で発射",
    );
  });

  it("reverses direction immediately after the paddle has been held against a wall", () => {
    // #given — ArrowRight held long past the track's right end. If the key
    // cursor were clamped to [0, canvasWidth] instead of the paddle centre's
    // own range, it would keep walking to 960 while the paddle sits at 920
    harness = mountSession();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    let now = 0;
    for (let i = 0; i < 25; i++) {
      now += 100;
      harness.raf.drain(now);
    }
    const atWall = paddleCenter(harness.container);

    // #when — one frame of ArrowLeft (100ms x 480px/s = 48px of travel)
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    now += 100;
    harness.raf.drain(now);

    // #then
    expect(atWall).toBeCloseTo(DEFAULT_CONFIG.canvasWidth - PADDLE_HALF, 5);
    expect(paddleCenter(harness.container)).toBeLessThan(atWall - 40);
  });

  it("tears down every listener it added", () => {
    // #given
    harness = mountSession();
    const canvas = harness.container.querySelector<HTMLCanvasElement>(".game-canvas");

    // #when
    harness.destroy();
    canvas?.dispatchEvent(pointer("pointerdown", 120, "mouse"));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));

    // #then
    expect(harness.container.querySelector(".play-stack")).toBeNull();
    expect(document.body.querySelector(".paddle-rail")).toBeNull();
  });
});
