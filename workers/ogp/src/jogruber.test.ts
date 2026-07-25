import { describe, expect, it } from "vitest";
import { parseJogruberContributions } from "./jogruber";

const VALID_RESPONSE = {
  total: { lastYear: 3 },
  contributions: [
    { date: "2024-01-01", count: 0, level: 0 },
    { date: "2024-01-02", count: 2, level: 1 },
    { date: "2024-01-03", count: 1, level: 4 },
  ],
};

describe("parseJogruberContributions", () => {
  it("converts a valid jogruber payload into ContributionCell[]", () => {
    // #given / #when
    const cells = parseJogruberContributions(VALID_RESPONSE);
    // #then
    expect(cells).toEqual([
      { date: "2024-01-01", count: 0, level: 0 },
      { date: "2024-01-02", count: 2, level: 1 },
      { date: "2024-01-03", count: 1, level: 4 },
    ]);
  });

  it("returns an empty array when contributions is empty", () => {
    // #given
    const empty = { total: { lastYear: 0 }, contributions: [] };
    // #when / #then
    expect(parseJogruberContributions(empty)).toEqual([]);
  });

  it("throws when the payload is not an object", () => {
    expect(() => parseJogruberContributions(null)).toThrow();
    expect(() => parseJogruberContributions("nope")).toThrow();
  });

  it("throws when contributions is missing", () => {
    expect(() => parseJogruberContributions({ total: { lastYear: 0 } })).toThrow();
  });

  it("throws when contributions is not an array", () => {
    expect(() => parseJogruberContributions({ contributions: {} })).toThrow();
  });

  it("throws when a cell is not an object", () => {
    expect(() => parseJogruberContributions({ contributions: ["oops"] })).toThrow();
  });

  it("throws when a cell's count is negative", () => {
    expect(() =>
      parseJogruberContributions({ contributions: [{ date: "2024-01-01", count: -1, level: 1 }] }),
    ).toThrow();
  });

  it("throws (instead of clamping) when a cell's level is above 4", () => {
    expect(() =>
      parseJogruberContributions({ contributions: [{ date: "2024-01-01", count: 1, level: 5 }] }),
    ).toThrow();
  });

  it("throws (instead of clamping) when a cell's level is negative", () => {
    expect(() =>
      parseJogruberContributions({ contributions: [{ date: "2024-01-01", count: 1, level: -1 }] }),
    ).toThrow();
  });
});
