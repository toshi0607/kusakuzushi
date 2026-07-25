import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FIXTURE_HTML from "./__fixtures__/contributions.html?raw";
import type { Session } from "./content";
import { mount } from "./content";
import { GRASS_DAY_SELECTOR } from "./grass-dom";

function loadFixture(): void {
  document.body.innerHTML = FIXTURE_HTML;
}

function launchButton(): HTMLButtonElement {
  const button = document.getElementById("kusakuzushi-launch");
  if (!(button instanceof HTMLButtonElement)) throw new Error("launch button missing");
  return button;
}

describe("mount", () => {
  let session: Session | null = null;

  beforeEach(() => {
    loadFixture();
  });

  afterEach(() => {
    // Undoes both the module-scope `activeSession` guard in content.ts and
    // any vi.spyOn stubs, so each test starts from a clean slate.
    session?.stop();
    session = null;
    vi.restoreAllMocks();
  });

  it("returns null and injects nothing when there is no grass table", () => {
    // #given a page that isn't a GitHub profile
    document.body.innerHTML = "<div>not a profile page</div>";
    // #when
    const result = mount(document, window);
    // #then
    expect(result).toBeNull();
    expect(document.getElementById("kusakuzushi-launch")).toBeNull();
  });

  it("injects exactly one launch button even when mounted twice", () => {
    // #given a real profile fragment
    // #when
    session = mount(document, window);
    mount(document, window);
    // #then
    expect(document.querySelectorAll("#kusakuzushi-launch")).toHaveLength(1);
  });

  it("shows the no-bricks message and does not start a game when every cell is level 0", () => {
    // #given a grass grid with no contributions at all
    document.querySelectorAll(GRASS_DAY_SELECTOR).forEach((el) => el.setAttribute("data-level", "0"));
    session = mount(document, window);
    // #when
    launchButton().click();
    // #then
    expect(document.body.textContent).toContain("崩す草がありません🌵");
    expect(launchButton().textContent).toBe("🎮 崩す");
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("stop() is safe to call twice", () => {
    // #given a mounted session
    session = mount(document, window);
    // #when / #then
    expect(() => {
      session?.stop();
      session?.stop();
    }).not.toThrow();
  });

  it("aborts safely without starting a game when the canvas has no 2D context (e.g. under jsdom)", () => {
    // #given a real (non-empty) grid, non-zero cell rects so geometry
    // measurement succeeds, but no 2D canvas context available
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    session = mount(document, window);
    // #when
    expect(() => launchButton().click()).not.toThrow();
    // #then the click was swallowed rather than starting a broken game
    expect(launchButton().textContent).toBe("🎮 崩す");
    expect(document.querySelector("canvas")).toBeNull();
  });
});
