import { beforeEach, describe, expect, it } from "vitest";

import FIXTURE_HTML from "./__fixtures__/contributions.html?raw";
import type { CellRect, ContributionLevel, GrassCell } from "./grass-dom";
import { findGrassTable, GRASS_TABLE_SELECTOR, measureGeometry, readGrassCells, readLevelColors } from "./grass-dom";

/** Builds a synthetic 7-row x `cols`-col rect grid: 10x10 cells, 3px gap, 13px stride. */
function makeCellGrid(cols: number): CellRect[] {
  const cellWidth = 10;
  const cellHeight = 10;
  const gap = 3;
  const stride = cellWidth + gap;
  const originX = 67;
  const originY = 181;

  const rects: CellRect[] = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < cols; col++) {
      rects.push({
        left: originX + col * stride,
        top: originY + row * stride,
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return rects;
}

describe("findGrassTable", () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  it("returns the ContributionCalendar-grid table from a real profile fragment", () => {
    // #given the fixture is loaded into the document
    // #when
    const table = findGrassTable(document);
    // #then
    expect(table).not.toBeNull();
    expect(table?.tagName).toBe("TABLE");
    expect(table?.matches(GRASS_TABLE_SELECTOR)).toBe(true);
  });
});

describe("readGrassCells", () => {
  beforeEach(() => {
    document.body.innerHTML = FIXTURE_HTML;
  });

  it("reads all 371 grass cells (53 weeks x 7 days), date-ascending, levels 0-4", () => {
    // #given
    const table = findGrassTable(document);
    if (!table) throw new Error("fixture missing ContributionCalendar-grid table");
    // #when
    const cells = readGrassCells(table);
    // #then
    expect(cells).toHaveLength(371);
    for (const cell of cells) {
      expect(cell.level).toBeGreaterThanOrEqual(0);
      expect(cell.level).toBeLessThanOrEqual(4);
      expect(cell.el).toBeInstanceOf(HTMLElement);
    }
    const dates = cells.map((cell) => cell.date);
    const sortedDates = [...dates].sort();
    expect(dates).toEqual(sortedDates);
  });
});

describe("measureGeometry", () => {
  it("returns null for an empty rect list", () => {
    // #given no rects
    // #when
    const geometry = measureGeometry([]);
    // #then
    expect(geometry).toBeNull();
  });

  it("infers cell size, gap, origin and column count from a 10x10/gap3/stride13/53-col grid", () => {
    // #given a synthetic grid matching the real GitHub measurements
    const rects = makeCellGrid(53);
    // #when
    const geometry = measureGeometry(rects);
    // #then
    expect(geometry).toEqual({
      cellWidth: 10,
      cellHeight: 10,
      gap: 3,
      cols: 53,
      originX: 67,
      originY: 181,
    });
  });

  it("returns gap 0 when there is only a single column (no horizontal stride to measure)", () => {
    // #given a single week (7 rows, 1 column)
    const rects = makeCellGrid(1);
    // #when
    const geometry = measureGeometry(rects);
    // #then
    expect(geometry).not.toBeNull();
    expect(geometry?.cols).toBe(1);
    expect(geometry?.gap).toBe(0);
    expect(geometry?.cellWidth).toBe(10);
    expect(geometry?.cellHeight).toBe(10);
  });

  it("returns null when a rect has non-positive width or height", () => {
    // #given one degenerate rect mixed into an otherwise valid grid
    const rects = [...makeCellGrid(2), { left: 200, top: 200, width: 0, height: 10 }];
    // #when
    const geometry = measureGeometry(rects);
    // #then
    expect(geometry).toBeNull();
  });
});

describe("readLevelColors", () => {
  // GitHub's real 5-step green scale (see task context / DESIGN.md).
  const REAL_COLORS = [
    "rgb(239, 242, 245)",
    "rgb(172, 238, 187)",
    "rgb(74, 194, 107)",
    "rgb(45, 164, 78)",
    "rgb(17, 99, 41)",
  ];

  let styleEl: HTMLStyleElement;

  function styleRuleFor(levels: readonly number[]): string {
    return levels.map((level) => `td[data-level="${level}"] { background-color: ${REAL_COLORS[level]}; }`).join("\n");
  }

  function makeCell(level: ContributionLevel, date: string): GrassCell {
    const el = document.createElement("td");
    el.setAttribute("data-level", String(level));
    document.body.appendChild(el);
    return { date, level, el };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    styleEl = document.createElement("style");
    document.head.appendChild(styleEl);
  });

  it("reads each level's computed background-color, returned index 0..4 regardless of input order", () => {
    // #given a stylesheet mapping every data-level 0-4 to GitHub's real colors,
    // and cells supplied out of level order
    styleEl.textContent = styleRuleFor([0, 1, 2, 3, 4]);
    const cells = [4, 2, 0, 3, 1].map((level) => makeCell(level as ContributionLevel, `2026-01-0${level + 1}`));
    // #when
    const colors = readLevelColors(cells, window);
    // #then
    expect(colors).toEqual(REAL_COLORS);
  });

  it("returns null when even one level (e.g. level 4) has no cell at all", () => {
    // #given a user who has never had a level-4 day: levels 0-3 are present, 4 is not
    styleEl.textContent = styleRuleFor([0, 1, 2, 3]);
    const cells = [0, 1, 2, 3].map((level) => makeCell(level as ContributionLevel, `2026-01-0${level + 1}`));
    // #when
    const colors = readLevelColors(cells, window);
    // #then all-or-nothing: a single missing level falls back to a bundled theme entirely
    expect(colors).toBeNull();
  });
});
