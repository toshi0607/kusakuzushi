import { describe, expect, it } from "vitest";
import type { Brick } from "./game";
import { harvestPercentage, harvestedCount } from "./harvest";

/** A brick carrying just what the harvest maths reads. */
function brick(count: number, alive: boolean): Brick {
  return { row: 0, col: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, level: alive ? 1 : 0, count, alive };
}

describe("harvestedCount", () => {
  it("sums count over destroyed bricks only", () => {
    // #given
    const source = { liveBricks: [brick(10, false), brick(4, true), brick(1, false)] };

    // #when / #then
    expect(harvestedCount(source)).toBe(11);
  });
});

describe("harvestPercentage", () => {
  it("weighs by count, not by brick count", () => {
    // #given 濃い草 1 個(count 9)だけを壊し、薄い草 3 個(count 1)を残した盤面。
    // ブロック数で数えれば 25% だが、消えたのは盤面の 4 分の 3。
    const source = { liveBricks: [brick(9, false), brick(1, true), brick(1, true), brick(1, true)] };

    // #when / #then
    expect(harvestPercentage(source, 12)).toBe(75);
  });

  it("floors, so one surviving brick can never read as 100%", () => {
    // #given 999/1000 — 100% は clear と同値でなければならない(OGP カードが
    // それに依存している)
    const source = { liveBricks: [brick(999, false), brick(1, true)] };

    // #when / #then
    expect(harvestPercentage(source, 1000)).toBe(99);
  });

  it("is 100 when every brick is destroyed", () => {
    // #given
    const source = { liveBricks: [brick(3, false), brick(7, false)] };

    // #when / #then
    expect(harvestPercentage(source, 10)).toBe(100);
  });

  it("is 0 for an empty board instead of dividing by zero", () => {
    // #given a board whose count total is 0 (a profile with no contributions)
    const source = { liveBricks: [] };

    // #when / #then
    expect(harvestPercentage(source, 0)).toBe(0);
  });
});
