import { beforeEach, describe, expect, it } from "vitest";

import { createTdPainter } from "./td-paint";

const LEVEL_COLORS = ["rgb(239, 242, 245)", "rgb(172, 238, 187)", "rgb(74, 194, 107)", "rgb(45, 164, 78)", "rgb(17, 99, 41)"];

describe("createTdPainter", () => {
  let bareTd: HTMLElement;
  let styledTd: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    bareTd = document.createElement("td");
    document.body.appendChild(bareTd);

    styledTd = document.createElement("td");
    styledTd.setAttribute("style", "width: 10px; outline: none;");
    document.body.appendChild(styledTd);
  });

  it("paints backgroundColor from levelColors, clamped to 0-4", () => {
    // #given
    const painter = createTdPainter(LEVEL_COLORS);
    // #when
    painter.paint(bareTd, 2);
    // #then
    expect(bareTd.style.backgroundColor).toBe(LEVEL_COLORS[2]);
  });

  it("clamps out-of-range levels into 0-4", () => {
    // #given
    const painter = createTdPainter(LEVEL_COLORS);
    // #when
    painter.paint(bareTd, 99);
    painter.paint(styledTd, -5);
    // #then
    expect(bareTd.style.backgroundColor).toBe(LEVEL_COLORS[4]);
    expect(styledTd.style.backgroundColor).toBe(LEVEL_COLORS[0]);
  });

  it("restoreAll removes the style attribute entirely from a td that had none", () => {
    // #given a td with no inline style before painting
    expect(bareTd.hasAttribute("style")).toBe(false);
    const painter = createTdPainter(LEVEL_COLORS);
    painter.paint(bareTd, 3);
    expect(bareTd.hasAttribute("style")).toBe(true);
    // #when
    painter.restoreAll();
    // #then the attribute is gone, not just emptied
    expect(bareTd.hasAttribute("style")).toBe(false);
  });

  it("restoreAll puts back the exact original style attribute of a td that already had one", () => {
    // #given
    const originalStyle = styledTd.getAttribute("style");
    const painter = createTdPainter(LEVEL_COLORS);
    painter.paint(styledTd, 1);
    expect(styledTd.getAttribute("style")).not.toBe(originalStyle);
    // #when
    painter.restoreAll();
    // #then
    expect(styledTd.getAttribute("style")).toBe(originalStyle);
  });

  it("restoreAll handles both a bare and an already-styled td together, then clears its record so a second call is a no-op", () => {
    // #given both elements painted
    const painter = createTdPainter(LEVEL_COLORS);
    const originalStyledAttr = styledTd.getAttribute("style");
    painter.paint(bareTd, 1);
    painter.paint(styledTd, 4);
    // #when
    painter.restoreAll();
    painter.restoreAll(); // second call must not throw or re-mutate anything
    // #then
    expect(bareTd.hasAttribute("style")).toBe(false);
    expect(styledTd.getAttribute("style")).toBe(originalStyledAttr);
  });

  it("does not touch data-level", () => {
    // #given
    bareTd.setAttribute("data-level", "2");
    const painter = createTdPainter(LEVEL_COLORS);
    // #when
    painter.paint(bareTd, 0);
    painter.restoreAll();
    // #then
    expect(bareTd.getAttribute("data-level")).toBe("2");
  });
});
