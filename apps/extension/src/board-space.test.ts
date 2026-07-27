import { beforeEach, describe, expect, it } from "vitest";

import { reserveBoardSpace } from "./board-space";

/** jsdom has no layout, so both boxes have to be spelled out. */
function stubBottom(el: HTMLElement, bottom: number): void {
  el.getBoundingClientRect = (): DOMRect => ({ top: 0, bottom, left: 0, right: 0, width: 0, height: bottom }) as DOMRect;
}

describe("reserveBoardSpace", () => {
  let anchor: HTMLElement;
  let canvas: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    anchor = document.createElement("div");
    canvas = document.createElement("canvas");
    document.body.append(anchor, canvas);
  });

  it("pushes what follows the calendar down by the overlay's overhang", () => {
    // #given a board whose lower half hangs 76px below the calendar — the
    // ball/paddle half, which would otherwise be drawn over GitHub's legend
    stubBottom(anchor, 463);
    stubBottom(canvas, 539);
    // #when
    reserveBoardSpace(anchor, canvas, window);
    // #then
    expect(anchor.style.marginBottom).toBe("76px");
  });

  it("adds to the margin already there rather than replacing it", () => {
    // #given the anchor already carries a margin
    anchor.style.marginBottom = "10px";
    stubBottom(anchor, 100);
    stubBottom(canvas, 130);
    // #when
    reserveBoardSpace(anchor, canvas, window);
    // #then the reserved space is on top of it, not instead of it
    expect(anchor.style.marginBottom).toBe("40px");
  });

  it("reserves nothing when the board already fits", () => {
    // #given an overlay that ends above the calendar's own bottom
    stubBottom(anchor, 500);
    stubBottom(canvas, 480);
    // #when
    reserveBoardSpace(anchor, canvas, window);
    // #then
    expect(anchor.getAttribute("style")).toBeNull();
  });

  it("restores the element exactly as found, attribute and all", () => {
    // #given an anchor with no style attribute at all
    stubBottom(anchor, 100);
    stubBottom(canvas, 200);
    // #when the space is reserved and then released
    const space = reserveBoardSpace(anchor, canvas, window);
    expect(anchor.getAttribute("style")).not.toBeNull();
    space.release();
    // #then the attribute is gone, not merely emptied — teardown has to leave
    // GitHub's DOM byte-identical, same as td-paint's restoreAll
    expect(anchor.getAttribute("style")).toBeNull();
  });

  it("restores a pre-existing inline style verbatim", () => {
    // #given an anchor that already had its own inline style
    anchor.setAttribute("style", "color: red;");
    stubBottom(anchor, 100);
    stubBottom(canvas, 200);
    // #when
    const space = reserveBoardSpace(anchor, canvas, window);
    space.release();
    // #then
    expect(anchor.getAttribute("style")).toBe("color: red;");
  });

  it("is safe to release twice", () => {
    // #given
    stubBottom(anchor, 100);
    stubBottom(canvas, 200);
    const space = reserveBoardSpace(anchor, canvas, window);
    // #when
    space.release();
    // #then
    expect(() => space.release()).not.toThrow();
    expect(anchor.getAttribute("style")).toBeNull();
  });
});
