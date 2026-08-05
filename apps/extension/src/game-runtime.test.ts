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

import { clearMessageFor, LIGHT_THEME, MARQUEE_COLOR } from "@kusakuzushi/core";

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

  // Wrapped, like GitHub's own markup: the wrapper is what board-space.ts
  // grows to make room for the paddle half of the board.
  const wrapper = document.createElement("div");
  wrapper.id = CALENDAR_WRAPPER_ID;
  wrapper.appendChild(table);
  document.body.appendChild(wrapper);
  return { tds, liveDate };
}

/** Real per-`td` geometry: 10x10 cells, 3px gap (stride 13), origin (67, 100) — matches the measured production values. */
/** Shifts every cell sideways, standing in for the page reflowing under the overlay. Reset per test. */
let layoutOffsetX = 0;

/** The calendar wrapper's and overlay's bottoms, so board-space.ts has a real overhang to reserve. */
const CALENDAR_WRAPPER_ID = "calendar-wrapper";
const WRAPPER_BOTTOM = 400;
const OVERLAY_BOTTOM = 500;
export const EXPECTED_RESERVED_PX = OVERLAY_BOTTOM - WRAPPER_BOTTOM;

function stubGeometry(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const flat = (bottom: number): DOMRect =>
      ({ left: 0, top: 0, width: 0, height: bottom, right: 0, bottom, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    if (this.tagName === "CANVAS") return flat(OVERLAY_BOTTOM);
    if (this.id === CALENDAR_WRAPPER_ID) return flat(WRAPPER_BOTTOM);

    const match = /^contribution-day-component-(\d+)-(\d+)$/.exec(this.id);
    if (!match) {
      return flat(0);
    }
    const row = Number(match[1]);
    const col = Number(match[2]);
    const left = ORIGIN_X + layoutOffsetX + col * STRIDE;
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
  /** The `fillStyle` in force at each `arc()` — the ball's colour, which the call arguments don't carry. */
  arcStyles: string[];
  /** The `fillStyle` in force at each `fillRect()`, same reason. */
  fillRectStyles: string[];
};

/** jsdom canvases have no real 2D context; this stubs just the methods/properties `overlay.ts`/`renderer.ts` call. */
function stubCanvasContext(): FakeCtx2D {
  const arcStyles: string[] = [];
  const fillRectStyles: string[] = [];
  const ctx = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(function (this: { fillStyle: string }): void {
      fillRectStyles.push(String(this.fillStyle));
    }),
    beginPath: vi.fn(),
    arc: vi.fn(function (this: { fillStyle: string }): void {
      arcStyles.push(String(this.fillStyle));
    }),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    fillStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "",
    shadowColor: "",
    shadowBlur: 0,
    arcStyles,
    fillRectStyles,
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
    layoutOffsetX = 0;
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

  it("draws the ball in marquee amber while the paddle keeps the page's own colour", () => {
    // #given a running game. Every other overlay colour is sampled off the
    // page so the board blends into GitHub, but a page-coloured ball turns
    // into a scatter of black dots once multiBall has split it a few times —
    // and the ball is the one thing the web version and the extension draw
    // identically, so it stays branded.
    const ctx = stubCanvasContext();
    buildSyntheticGrass({ row: 4, col: 3 });
    session = mount(document, window);
    launchButton().click();

    // #when a frame is drawn
    raf.drain(window.performance.now() + 16);

    // #then the ball (the only arc the renderer draws) is amber, and the
    // paddle is still the page's foreground colour
    expect(ctx.arcStyles).toContain(MARQUEE_COLOR);
    expect(ctx.arcStyles).not.toContain(LIGHT_THEME.paddleColor);
    expect(ctx.fillRectStyles).toContain(LIGHT_THEME.paddleColor);
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

  it("makes room below the calendar for the paddle half of the board, and gives it back on stop()", () => {
    // #given a running game whose overlay hangs below the calendar. Without
    // the reservation the paddle, the HUD and the guide are all drawn over
    // GitHub's own legend and organisation chips.
    stubCanvasContext();
    buildSyntheticGrass({ row: 4, col: 3 });
    session = mount(document, window);
    launchButton().click();

    const wrapper = document.getElementById(CALENDAR_WRAPPER_ID);
    if (!wrapper) throw new Error("calendar wrapper missing");
    // #then the page below is pushed down by exactly the overhang
    expect(wrapper.style.marginBottom).toBe(`${EXPECTED_RESERVED_PX}px`);

    // #when the session ends
    session?.stop();
    session = null;
    // #then the wrapper is byte-identical to how it was found
    expect(wrapper.getAttribute("style")).toBeNull();
  });

  describe("resize", () => {
    /** Makes the wrapper clip horizontally, showing `clientWidth` px of the calendar. */
    function clipCalendarTo(clientWidth: number): void {
      const wrapper = document.getElementById(CALENDAR_WRAPPER_ID);
      if (!wrapper) throw new Error("calendar wrapper missing");
      wrapper.style.overflowX = "auto";
      Object.defineProperty(wrapper, "scrollWidth", { value: 300, configurable: true });
      Object.defineProperty(wrapper, "clientWidth", { value: clientWidth, configurable: true });
    }

    it("follows the grass to its new position instead of leaving the overlay behind", () => {
      // #given a round in progress
      buildSyntheticGrass({ row: 4, col: 3 });
      session = mount(document, window);
      launchButton().click();
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("overlay missing");
      const before = canvas.style.left;

      // #when the page reflows sideways under the absolutely-positioned overlay
      layoutOffsetX = 40;
      window.dispatchEvent(new Event("resize"));
      raf.drain(100);

      // #then the overlay moved with it, and the round is still going
      expect(canvas.style.left).toBe(`${ORIGIN_X + 40 - GAP}px`);
      expect(canvas.style.left).not.toBe(before);
      expect(launchButton().textContent).toBe("やめる");
      expect(document.querySelector("canvas")).not.toBeNull();
    });

    it("ends the round when the resize changes how many weeks are visible", () => {
      // #given a round started while the whole calendar was on screen
      buildSyntheticGrass({ row: 4, col: 3 });
      clipCalendarTo(200);
      session = mount(document, window);
      launchButton().click();
      expect(document.querySelector("canvas")).not.toBeNull();

      // #when the window narrows enough to hide the last week. That is a
      // different set of bricks with a different clear condition — not
      // something the running board can be moved onto.
      clipCalendarTo(150);
      window.dispatchEvent(new Event("resize"));
      raf.drain(100);

      // #then the round is over, the overlay is gone, and it says why
      expect(document.querySelector("canvas")).toBeNull();
      expect(launchButton().textContent).toBe("🎮 崩す");
      expect(document.getElementById("kusakuzushi-message")?.textContent).toContain("中断");
    });
  });

  describe("clear banner", () => {
    /** Plays the one-brick board to its clear and returns the banner's text. */
    function playToClear(): string {
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
      if (!banner) throw new Error("the round never finished");
      return banner.textContent ?? "";
    }

    it("adds the one-liner for the size of year the page's own heading reports", () => {
      // #given a profile whose graph heading reports 2,988 contributions
      buildSyntheticGrass({ row: 4, col: 3 });
      const heading = document.createElement("h2");
      heading.id = "js-contribution-activity-description";
      heading.textContent = "2,988 contributions in the last year";
      document.body.appendChild(heading);

      // #when
      const text = playToClear();

      // #then
      expect(text).toContain(clearMessageFor(2988));
    });

    it("stays silent when the heading is missing, rather than guessing a tier", () => {
      // #given a page with no contribution heading at all (a markup change,
      // or a Turbo visit that hasn't rendered it yet)
      buildSyntheticGrass({ row: 4, col: 3 });

      // #when
      const text = playToClear();

      // #then the heading is still there, but nothing was made up under it
      expect(text).toContain("完全刈り取り");
      for (const total of [50, 250, 900, 2000, 5000]) {
        expect(text).not.toContain(clearMessageFor(total));
      }
    });
  });

  describe("X share link", () => {
    /** Plays the one-brick board to its clear and returns the finished banner. */
    function playToBanner(): HTMLElement {
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
      if (!banner) throw new Error("the round never finished");
      return banner;
    }

    /** The banner's share anchor. */
    function shareLink(banner: HTMLElement): HTMLAnchorElement {
      const link = banner.querySelector("a");
      if (!link) throw new Error("the banner has no share link");
      return link;
    }

    it("posts the profile's username and the harvest percentage, tagged #草崩し", () => {
      // #given the one-brick board played to its clear on github.com/toshi0607
      buildSyntheticGrass({ row: 4, col: 3 });

      // #when
      const link = shareLink(playToBanner());

      // #then
      const intent = new URL(link.href);
      expect(intent.origin + intent.pathname).toBe("https://x.com/intent/post");
      expect(intent.searchParams.get("text")).toBe("toshi0607 の草を GitHub 上で 100% 刈り取った🌱 #草崩し");
      expect(intent.searchParams.get("url")).toBe("https://kusakuzushi.toshi0607.com/share/toshi0607?p=100");
      expect(link.textContent).toBe("Xで共有");
    });

    it("opens in a new tab without handing the opener to x.com", () => {
      // #given / #when
      buildSyntheticGrass({ row: 4, col: 3 });
      const link = shareLink(playToBanner());

      // #then leaving GitHub mid-page would lose the board the player is
      // looking at, and `noopener` keeps the new tab off `window.opener`
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    });

    it("shares no score, since the extension's is level² and the web app's is not", () => {
      // #given / #when
      buildSyntheticGrass({ row: 4, col: 3 });
      const link = shareLink(playToBanner());

      // #then neither the text nor the card URL carries one (adapter.ts)
      expect(link.href).not.toContain("s=");
      expect(new URL(link.href).searchParams.get("text")).not.toContain("スコア");
    });

    it("leaves もう一回 / やめる where they were, so the new button can't be mis-clicked for them", () => {
      // #given / #when
      buildSyntheticGrass({ row: 4, col: 3 });
      const banner = playToBanner();

      // #then
      const labels = [...banner.querySelectorAll("button")].map((b) => b.textContent);
      expect(labels).toEqual(["もう一回", "やめる"]);
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
