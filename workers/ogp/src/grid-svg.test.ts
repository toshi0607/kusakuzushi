import { describe, expect, it } from "vitest";
import { buildContributionGridSvg, svgToDataUri } from "./grid-svg";
import type { ContributionCell } from "./jogruber";

const CELL = (level: ContributionCell["level"]): ContributionCell => ({ date: "2024-01-01", count: 1, level });

describe("buildContributionGridSvg", () => {
  it("returns a 0x0 svg for an empty contributions grid (no weeks)", () => {
    // #given no weeks (e.g. empty contributions array)
    // #when
    const svg = buildContributionGridSvg([]);
    // #then
    expect(svg).toContain('width="0"');
    expect(svg).toContain('height="0"');
    expect(svg).not.toContain("<rect");
  });

  it("renders one rect per cell with the level-appropriate color", () => {
    // #given a single week with one cell at each level
    const weeks: ContributionCell[][] = [[CELL(0), CELL(1), CELL(2), CELL(3), CELL(4)]];
    // #when
    const svg = buildContributionGridSvg(weeks);
    // #then
    expect(svg).toContain('fill="#161b22"');
    expect(svg).toContain('fill="#0e4429"');
    expect(svg).toContain('fill="#006d32"');
    expect(svg).toContain('fill="#26a641"');
    expect(svg).toContain('fill="#39d353"');
    expect((svg.match(/<rect/g) ?? []).length).toBe(5);
  });

  it("sizes the svg by column/row count", () => {
    // #given 2 weeks of 7 days each
    const week: ContributionCell[] = new Array(7).fill(CELL(1));
    const weeks: ContributionCell[][] = [week, week];
    // #when
    const svg = buildContributionGridSvg(weeks);
    // #then width = 2 * (11 + 3) - 3 = 25, height = 7 * (11 + 3) - 3 = 95
    expect(svg).toContain('width="25"');
    expect(svg).toContain('height="95"');
  });
});

describe("svgToDataUri", () => {
  it("encodes the svg as a base64 data URI", () => {
    // #given
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    // #when
    const uri = svgToDataUri(svg);
    // #then
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const base64 = uri.slice("data:image/svg+xml;base64,".length);
    expect(atob(base64)).toBe(svg);
  });
});
