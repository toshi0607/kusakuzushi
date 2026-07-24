import { describe, expect, it } from "vitest";
import { toGrid } from "./model";
import type { Cell } from "./model";

/** Builds `n` consecutive UTC-day cells starting at `startDate` (YYYY-MM-DD). */
function makeCells(startDate: string, n: number, level: (i: number) => Cell["level"] = () => 1): Cell[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      count: i,
      level: level(i),
    };
  });
}

function nearestSundayOnOrAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day !== 0) d.setUTCDate(d.getUTCDate() + (7 - day));
  return d.toISOString().slice(0, 10);
}

describe("toGrid", () => {
  it("returns an empty grid for an empty contributions array", () => {
    // #given no contributions
    // #when
    const grid = toGrid("octocat", []);
    // #then
    expect(grid).toEqual({ username: "octocat", weeks: [], total: 0 });
  });

  it("pads the leading days of the first week when the year does not start on Sunday", () => {
    // #given 2024-01-03 is a Wednesday (day-of-week 3), 10 consecutive days
    const cells = makeCells("2024-01-03", 10);
    // #when
    const grid = toGrid("octocat", cells);
    // #then first week: 3 padding cells then Wed..Sat (4 real cells)
    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks[0]).toHaveLength(7);
    expect(grid.weeks[0][0]).toEqual({ date: "", count: 0, level: 0 });
    expect(grid.weeks[0][1]).toEqual({ date: "", count: 0, level: 0 });
    expect(grid.weeks[0][2]).toEqual({ date: "", count: 0, level: 0 });
    expect(grid.weeks[0][3]).toEqual(cells[0]);
    expect(grid.weeks[0][6]).toEqual(cells[3]);
    // second week gets the remaining 6 real cells, padded with 1 trailing cell
    expect(grid.weeks[1][0]).toEqual(cells[4]);
    expect(grid.weeks[1][5]).toEqual(cells[9]);
    expect(grid.weeks[1][6]).toEqual({ date: "", count: 0, level: 0 });
  });

  it("produces exactly 53 full weeks with no padding when the range starts on Sunday and is a multiple of 7", () => {
    // #given a Sunday-aligned run of 53 * 7 days
    const startSunday = nearestSundayOnOrAfter("2023-01-01");
    const cells = makeCells(startSunday, 53 * 7, (i) => ((i % 5) as Cell["level"]));
    // #when
    const grid = toGrid("octocat", cells);
    // #then
    expect(grid.weeks).toHaveLength(53);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      for (const cell of week) {
        expect(cell.date).not.toBe("");
      }
    }
    expect(grid.weeks[0][0]).toEqual(cells[0]);
    expect(grid.weeks[52][6]).toEqual(cells[370]);
  });

  it("sums total from counts and preserves grid shape when every cell has level 0", () => {
    // #given a Sunday-aligned run of 2 full weeks, all zero contributions
    const startSunday = nearestSundayOnOrAfter("2023-01-01");
    const cells = makeCells(startSunday, 14, () => 0).map((c) => ({ ...c, count: 0 }));
    // #when
    const grid = toGrid("nobody", cells);
    // #then
    expect(grid.total).toBe(0);
    expect(grid.weeks).toHaveLength(2);
    expect(grid.weeks.flat().every((cell) => cell.level === 0)).toBe(true);
  });
});
