import { beforeEach, describe, expect, it } from "vitest";

import FIXTURE_HTML from "./__fixtures__/contributions.html?raw";
import type { CellRect, ContributionLevel, GrassCell } from "./grass-dom";
import {
  findGrassTable,
  GRASS_TABLE_SELECTOR,
  measureGeometry,
  readGrassCells,
  readLevelColors,
  readYearlyTotal,
  visibleCells,
} from "./grass-dom";

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

describe("readYearlyTotal", () => {
  it("reads the comma-separated total off a real profile fragment", () => {
    // #given the fixture's heading reads "2,988 contributions in the last year"
    document.body.innerHTML = FIXTURE_HTML;
    // #when
    const total = readYearlyTotal(document);
    // #then
    expect(total).toBe(2988);
  });

  it("takes the largest number, so a localised heading isn't read as its year count", () => {
    // #given GitHub's Japanese heading, where "1 年間" precedes the real total
    document.body.innerHTML =
      '<h2 id="js-contribution-activity-description">過去 1 年間に 2,988 コントリビューション</h2>';
    // #when
    const total = readYearlyTotal(document);
    // #then
    expect(total).toBe(2988);
  });

  it("returns null when the heading is missing or carries no number", () => {
    // #given a page whose graph heading never rendered
    document.body.innerHTML = "<div></div>";
    expect(readYearlyTotal(document)).toBeNull();
    // #and a heading with no digits at all (markup GitHub could ship next)
    document.body.innerHTML = '<h2 id="js-contribution-activity-description">contributions</h2>';
    expect(readYearlyTotal(document)).toBeNull();
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

describe("visibleCells", () => {
  const CELL_SIZE = 10;

  function stubRect(el: HTMLElement, left: number, width: number): void {
    // jsdom has no layout, so every rect is zeros unless it's spelled out.
    el.getBoundingClientRect = (): DOMRect =>
      ({ left, right: left + width, top: 0, bottom: CELL_SIZE, width, height: CELL_SIZE }) as DOMRect;
  }

  /**
   * A row of `count` cells inside a container that shows `clientWidth` px of
   * `scrollWidth` px — GitHub's own `overflow-x: auto` calendar on a narrow
   * window. `scrollLeft` only shifts where the cells are drawn.
   */
  function makeClippedRow(count: number, clientWidth: number, scrollLeft = 0): GrassCell[] {
    const container = document.createElement("div");
    container.style.overflowX = "auto";
    Object.defineProperty(container, "clientWidth", { value: clientWidth, configurable: true });
    Object.defineProperty(container, "scrollWidth", { value: count * CELL_SIZE, configurable: true });
    container.getBoundingClientRect = (): DOMRect =>
      ({ left: 0, right: clientWidth, top: 0, bottom: CELL_SIZE, width: clientWidth, height: CELL_SIZE }) as DOMRect;
    document.body.appendChild(container);

    return Array.from({ length: count }, (_, index) => {
      const el = document.createElement("td");
      el.setAttribute("data-level", "1");
      container.appendChild(el);
      stubRect(el, index * CELL_SIZE - scrollLeft, CELL_SIZE);
      return { date: `2026-01-${String(index + 1).padStart(2, "0")}`, level: 1 as ContributionLevel, el };
    });
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("drops the cells a clipped container is hiding off the right edge", () => {
    // #given 10 cells of 10px in a container showing only 60px of them
    const cells = makeClippedRow(10, 60);
    // #when
    const visible = visibleCells(cells, window);
    // #then only the six fully-visible cells survive, and they stay contiguous
    // and date-ascending so the grid still folds
    expect(visible.map((c) => c.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
    ]);
  });

  it("drops cells scrolled off the left edge too", () => {
    // #given the same row scrolled right by two cells
    const cells = makeClippedRow(10, 60, 2 * CELL_SIZE);
    // #when
    const visible = visibleCells(cells, window);
    // #then the run starts where the view does
    expect(visible.map((c) => c.date)).toEqual([
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
  });

  it("returns every cell when the container is wide enough to clip nothing", () => {
    // #given a container as wide as its content — the ordinary case
    const cells = makeClippedRow(10, 10 * CELL_SIZE);
    // #when
    const visible = visibleCells(cells, window);
    // #then nothing is dropped (and the same array comes back)
    expect(visible).toBe(cells);
  });

  it("returns an empty list unchanged", () => {
    // #given
    // #when
    const visible = visibleCells([], window);
    // #then
    expect(visible).toEqual([]);
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
    // Drop the previous test's rules too — they are keyed on `data-level`
    // alone, so a leftover sheet silently answers for a level this test
    // deliberately left unstyled.
    document.head.querySelectorAll("style").forEach((el) => el.remove());
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

  it("probes a level that has no cell, so a profile with no idle days still gets GitHub's real level-0 colour", () => {
    // #given someone who contributed every single day: GitHub styles level 0,
    // but the graph contains no level-0 cell to read it from
    styleEl.textContent = styleRuleFor([0, 1, 2, 3, 4]);
    const cells = [1, 2, 3, 4].map((level) => makeCell(level as ContributionLevel, `2026-01-0${level + 1}`));
    // #when
    const colors = readLevelColors(cells, window);
    // #then level 0 comes back from the page, not from a bundled theme.
    // Before this, the whole read failed and destroyed cells were painted with
    // the OS-derived theme — near-black on a light GitHub.
    expect(colors).toEqual(REAL_COLORS);
  });

  it("leaves the DOM exactly as it found it after probing", () => {
    // #given a graph missing level 0
    styleEl.textContent = styleRuleFor([0, 1, 2, 3, 4]);
    const cells = [1, 2, 3, 4].map((level) => makeCell(level as ContributionLevel, `2026-01-0${level + 1}`));
    const before = document.body.innerHTML;
    // #when
    readLevelColors(cells, window);
    // #then the throwaway probe cell is gone
    expect(document.body.innerHTML).toBe(before);
    expect(document.body.querySelectorAll("td")).toHaveLength(cells.length);
  });

  it("returns null when the missing level has no rule to read either", () => {
    // #given level 0 is neither present nor styled: probing yields a transparent
    // background, which would paint nothing at all
    styleEl.textContent = styleRuleFor([1, 2, 3, 4]);
    const cells = [1, 2, 3, 4].map((level) => makeCell(level as ContributionLevel, `2026-01-0${level + 1}`));
    // #when
    const colors = readLevelColors(cells, window);
    // #then the caller keeps its bundled-theme fallback
    expect(colors).toBeNull();
  });

  it("returns null when there are no cells to read or probe from", () => {
    // #given
    styleEl.textContent = styleRuleFor([0, 1, 2, 3, 4]);
    // #when
    const colors = readLevelColors([], window);
    // #then
    expect(colors).toBeNull();
  });
});
