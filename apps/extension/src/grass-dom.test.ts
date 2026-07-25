import { beforeEach, describe, expect, it } from "vitest";

import FIXTURE_HTML from "./__fixtures__/contributions.html?raw";
import type { CellRect } from "./grass-dom";
import { findGrassTable, GRASS_TABLE_SELECTOR, measureGeometry, readGrassCells } from "./grass-dom";

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
