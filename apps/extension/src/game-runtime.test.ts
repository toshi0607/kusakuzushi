/**
 * Exercises `createGameRuntime` (via `mount`'s button click), which every
 * other content.test.ts scenario stops short of: jsdom has no real 2D
 * canvas context, so without stubbing one the game never actually starts.
 * These tests stub just enough (`getContext`, `getBoundingClientRect`,
 * `requestAnimationFrame`/`cancelAnimationFrame`) to launch a real `Game`,
 * drive it to a brick hit, and verify the two riskiest wiring points:
 * `onBrickHit` -> real `td` resolution, and full teardown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIGHT_THEME } from "@kusakuzushi/core";

import type { Session } from "./content";
import { mount } from "./content";

const BUTTON_ID = "kusakuzushi-launch";
const BANNER_ID = "kusakuzushi-result-banner";
const BUTTON_LABEL_IDLE = "🎮 崩す";
const BUTTON_LABEL_ACTIVE = "やめる";

const ROWS = 7;
const COLS = 7;
const CELL_SIZE = 10;
const GAP = 3;
const STRIDE = CELL_SIZE + GAP;
const ORIGIN_X = 67;
const ORIGIN_Y = 100;

/** First date is a Sunday so `toGrid` folds these 49 days into exactly 7 weeks x 7 rows with no padding. */
const START_DATE = new Date("2024-01-07T00:00:00Z");

function dateAt(index: number): string {
  const d = new Date(START_DATE);
  d.setUTCDate(d.getUTCDate() + index);
  return d.toISOString().slice(0, 10);
}

/** `row`/`col` -> the date `toGrid` will fold into that exact grid cell (col = week, row = weekday, both 0-based). */
function dateFor(row: number, col: number): string {
  return dateAt(col * ROWS + row);
}

type SyntheticGrass = {
  tds: Map<string, HTMLTableCellElement>;
  liveDate: string;
};

/** Builds a `COLS`x`ROWS` grass table with exactly one live (level 1) brick at `live`; every other cell is level 0. */
function buildSyntheticGrass(live: { row: number; col: number }): SyntheticGrass {
  const table = document.createElement("table");
  table.className = "ContributionCalendar-grid";
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  const tds = new Map<string, HTMLTableCellElement>();
  let liveDate = "";

  for (let row = 0; row < ROWS; row++) {
    const tr = document.createElement("tr");
    for (let col = 0; col < COLS; col++) {
      const td = document.createElement("td");
      td.className = "ContributionCalendar-day";
      td.id = `contribution-day-component-${row}-${col}`;
      const isLive = row === live.row && col === live.col;
      const date = dateFor(row, col);
      td.setAttribute("data-date", date);
      td.setAttribute("data-level", isLive ? "1" : "0");
      // Mirrors the real fixture: every real grass `td` already carries an
      // inline `style="width: 10px"` before the extension ever touches it.
      td.setAttribute("style", "width: 10px");
      tr.appendChild(td);
      tds.set(`${row}:${col}`, td);
      if (isLive) liveDate = date;
    }
    tbody.appendChild(tr);
  }

  document.body.appendChild(table);
  return { tds, liveDate };
}

/** Real per-`td` geometry: 10x10 cells, 3px gap (stride 13), origin (67, 100) — matches the measured production values. */
function stubGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const match = /^contribution-day-component-(\d+)-(\d+)$/.exec(this.id);
    if (!match) {
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    const row = Number(match[1]);
    const col = Number(match[2]);
    const left = ORIGIN_X + col * STRIDE;
    const top = ORIGIN_Y + row * STRIDE;
    return {
      left,
      top,
      width: CELL_SIZE,
      height: CELL_SIZE,
      right: left + CELL_SIZE,
      bottom: top + CELL_SIZE,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

type FakeCtx2D = CanvasRenderingContext2D & {
  scale: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
};

/** jsdom canvases have no real 2D context; this stubs just the methods/properties `overlay.ts`/`renderer.ts` call. */
function stubCanvasContext(): FakeCtx2D {
  const ctx = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "",
    shadowColor: "",
    shadowBlur: 0,
  } as unknown as FakeCtx2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return ctx;
}

type FakeRaf = {
  /** Runs every callback currently queued, passing `now`, then clears the queue (mirrors a single real animation frame). */
  drain(now: number): void;
  pendingCount(): number;
};

/**
 * A Map-keyed-by-id queue, not a plain array: `content.ts`'s `frame()`
 * re-schedules itself by calling `requestAnimationFrame` again before the
 * next `drain`, and `teardown` cancels by id via `cancelAnimationFrame`.
 * An array-based fake that just clears everything on any cancel would
 * silently pass even if `teardown` cancelled the wrong id.
 */
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
    pendingCount(): number {
      return callbacks.size;
    },
  };
}

function launchButton(): HTMLButtonElement {
  const button = document.getElementById(BUTTON_ID);
  if (!(button instanceof HTMLButtonElement)) throw new Error("launch button missing");
  return button;
}

/** The colour `td-paint.ts` normalizes `LIGHT_THEME.colors[0]` to once round-tripped through an element's inline style. */
function normalizedColor(cssColor: string): string {
  const probe = document.createElement("div");
  probe.style.backgroundColor = cssColor;
  return probe.style.backgroundColor;
}

describe("createGameRuntime (via mount)", () => {
  let session: Session | null = null;
  let raf: FakeRaf;

  beforeEach(() => {
    document.body.innerHTML = "";
    stubCanvasContext();
    stubGeometry();
    raf = stubRaf();
  });

  afterEach(() => {
    session?.stop();
    session = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("starting a game flips the button label to やめる and adds a canvas", () => {
    // #given a grass grid with one live brick
    buildSyntheticGrass({ row: 4, col: 3 });
    session = mount(document, window);
    // #when
    launchButton().click();
    // #then
    expect(launchButton().textContent).toBe(BUTTON_LABEL_ACTIVE);
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  describe("onBrickHit -> real td resolution", () => {
    it("paints exactly the td of the destroyed day's brick, and no other td", () => {
      // #given a grid where only row 4 / col 3 is a live brick (level 1), dead centre
      // under the default paddle position for a 7-column board — the ball
      // launches straight up (vx=0) and will hit it if the row/col -> date ->
      // element lookup in content.ts is correct.
      const { tds } = buildSyntheticGrass({ row: 4, col: 3 });
      session = mount(document, window);
      launchButton().click();
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("canvas missing after starting the game");

      // #when the ball is launched and driven until the round ends
      canvas.dispatchEvent(new MouseEvent("click"));
      let now = window.performance.now();
      let banner: HTMLElement | null = null;
      for (let i = 0; i < 60 && !banner; i++) {
        now += 100;
        raf.drain(now);
        banner = document.getElementById(BANNER_ID);
      }

      // #then the round actually finished (sanity: physics really advanced)
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain("完全刈り取り");

      // #and the destroyed day's own td is painted the level-0 colour...
      const liveTd = tds.get("4:3");
      if (!liveTd) throw new Error("expected td missing");
      expect(liveTd.style.backgroundColor).toBe(normalizedColor(LIGHT_THEME.colors[0]));

      // #and no other td was touched
      for (const [key, td] of tds) {
        if (key === "4:3") continue;
        expect(td.getAttribute("style")).toBe("width: 10px");
      }
    });
  });

  describe("teardown", () => {
    it("stop() removes the canvas, cancels the pending rAF, and restores every painted td's original style", () => {
      // #given a game destroyed its one brick, so exactly one td was repainted
      const { tds } = buildSyntheticGrass({ row: 4, col: 3 });
      session = mount(document, window);
      launchButton().click();
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("canvas missing after starting the game");
      canvas.dispatchEvent(new MouseEvent("click"));

      let now = window.performance.now();
      let banner: HTMLElement | null = null;
      for (let i = 0; i < 60 && !banner; i++) {
        now += 100;
        raf.drain(now);
        banner = document.getElementById(BANNER_ID);
      }
      expect(banner).not.toBeNull();
      const liveTd = tds.get("4:3");
      if (!liveTd) throw new Error("expected td missing");
      expect(liveTd.getAttribute("style")).not.toBe("width: 10px");
      expect(raf.pendingCount()).toBe(0); // the frame loop stopped scheduling once the round ended

      const cancelSpy = vi.mocked(window.cancelAnimationFrame);

      // #when the player stops the (already-finished) round via the launch button
      launchButton().click();

      // #then the canvas is gone, cancelAnimationFrame ran, and every td is back exactly as found
      expect(document.querySelector("canvas")).toBeNull();
      expect(cancelSpy).toHaveBeenCalled();
      expect(raf.pendingCount()).toBe(0);
      for (const [, td] of tds) {
        expect(td.getAttribute("style")).toBe("width: 10px");
      }
      expect(launchButton().textContent).toBe(BUTTON_LABEL_IDLE);
    });

    it("removes the window mousemove/keydown listeners so post-teardown input is inert", () => {
      // #given a running game
      buildSyntheticGrass({ row: 4, col: 3 });
      const addSpy = vi.spyOn(window, "addEventListener");
      const removeSpy = vi.spyOn(window, "removeEventListener");
      session = mount(document, window);
      launchButton().click();
      expect(document.querySelector("canvas")).not.toBeNull();

      const mousemoveHandler = addSpy.mock.calls.find(([type]) => type === "mousemove")?.[1];
      const keydownHandler = addSpy.mock.calls.find(([type]) => type === "keydown")?.[1];
      expect(mousemoveHandler).toBeDefined();
      expect(keydownHandler).toBeDefined();
      // Mid-game, so the frame loop really is holding a scheduled callback —
      // this is what makes the post-stop assertion below non-vacuous.
      expect(raf.pendingCount()).toBe(1);

      // #when the game is stopped
      launchButton().click();

      // #then the exact same handler references were unregistered...
      expect(removeSpy).toHaveBeenCalledWith("mousemove", mousemoveHandler);
      expect(removeSpy).toHaveBeenCalledWith("keydown", keydownHandler);
      // #and the in-flight frame was cancelled by its own id
      expect(raf.pendingCount()).toBe(0);

      // #and dispatching them afterwards is a harmless no-op (no canvas to crash into)
      expect(() => {
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 50 }));
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
      }).not.toThrow();
      expect(document.querySelector("canvas")).toBeNull();
    });
  });

  describe("keyboard control", () => {
    /**
     * The paddle's x, read off the stubbed context.
     *
     * Picked as the widest `fillRect` of the frame rather than the last one:
     * the paddle is at least `MIN_PADDLE_WIDTH_PX` (48) across, while every
     * other rectangle the overlay draws — particles, items, the HUD plates —
     * is a few px wide. Keying on draw order instead made this silently read
     * the HUD once the HUD gained a background plate.
     */
    function paddleXAfterFrame(ctx: FakeCtx2D, now: number): number {
      ctx.fillRect.mockClear();
      raf.drain(now);
      const widest = ctx.fillRect.mock.calls.reduce<unknown[] | null>(
        (best, call) => (best === null || Number(call[2]) > Number(best[2]) ? call : best),
        null,
      );
      if (!widest) throw new Error("no paddle drawn this frame");
      return Number(widest[0]);
    }

    it("an arrow key moves the paddle immediately after the pointer was far outside the board", () => {
      // #given a game whose paddle was last driven by a mousemove far to the
      // right of the ~200px board — the everyday case, since the listener is
      // on `window` and GitHub pages are much wider than the grass
      const ctx = stubCanvasContext();
      buildSyntheticGrass({ row: 4, col: 3 });
      session = mount(document, window);
      launchButton().click();
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 0 }));
      const clampedX = paddleXAfterFrame(ctx, 100);

      // #when the player nudges left once
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));

      // #then the paddle moves by exactly one step. Without clamping the
      // internal cursor, it would sit at ~5000 and take dozens of presses
      // to walk back into range before moving at all.
      expect(paddleXAfterFrame(ctx, 200)).toBe(clampedX - 24);
    });

    it("ignores keys typed into GitHub's own inputs", () => {
      // #given a running game and a focused text field (GitHub's search box)
      const ctx = stubCanvasContext();
      buildSyntheticGrass({ row: 4, col: 3 });
      session = mount(document, window);
      launchButton().click();
      const input = document.createElement("input");
      document.body.appendChild(input);
      const startX = paddleXAfterFrame(ctx, 100);

      // #when arrow keys and a space are typed into it
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));

      // #then the game ignored them entirely
      expect(paddleXAfterFrame(ctx, 200)).toBe(startX);
    });
  });
});
