import { afterEach, describe, expect, it, vi } from "vitest";

import { ContributionFetchError, UserNotFoundError, fetchGrid, hasBricks, parseContributions } from "./api";

const VALID_RESPONSE = {
  total: { lastYear: 3 },
  contributions: [
    { date: "2024-01-01", count: 0, level: 0 },
    { date: "2024-01-02", count: 2, level: 1 },
    { date: "2024-01-03", count: 1, level: 1 },
  ],
};

describe("parseContributions", () => {
  it("converts a valid jogruber payload into Cell[]", () => {
    expect(parseContributions(VALID_RESPONSE)).toEqual([
      { date: "2024-01-01", count: 0, level: 0 },
      { date: "2024-01-02", count: 2, level: 1 },
      { date: "2024-01-03", count: 1, level: 1 },
    ]);
  });

  it("throws when the payload is not an object", () => {
    expect(() => parseContributions(null)).toThrow();
    expect(() => parseContributions("nope")).toThrow();
    expect(() => parseContributions(42)).toThrow();
  });

  it("throws when total.lastYear is missing", () => {
    expect(() => parseContributions({ contributions: [] })).toThrow();
  });

  it("throws when total.lastYear is not a number", () => {
    expect(() => parseContributions({ total: { lastYear: "3" }, contributions: [] })).toThrow();
  });

  it("throws when contributions is missing", () => {
    expect(() => parseContributions({ total: { lastYear: 0 } })).toThrow();
  });

  it("throws when contributions is not an array", () => {
    expect(() => parseContributions({ total: { lastYear: 0 }, contributions: {} })).toThrow();
  });

  it("throws when a cell is not an object", () => {
    expect(() => parseContributions({ total: { lastYear: 1 }, contributions: ["oops"] })).toThrow();
  });

  it("throws when a cell's date is not a string", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: 20240101, count: 1, level: 1 }],
      }),
    ).toThrow();
  });

  it("throws when a cell's count is not a number", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: "2024-01-01", count: "1", level: 1 }],
      }),
    ).toThrow();
  });

  it("throws when a cell's count is negative", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: "2024-01-01", count: -1, level: 1 }],
      }),
    ).toThrow();
  });

  it("throws (instead of clamping) when a cell's level is above 4", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: "2024-01-01", count: 1, level: 5 }],
      }),
    ).toThrow();
  });

  it("throws (instead of clamping) when a cell's level is negative", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: "2024-01-01", count: 1, level: -1 }],
      }),
    ).toThrow();
  });

  it("throws when a cell's level is not an integer", () => {
    expect(() =>
      parseContributions({
        total: { lastYear: 1 },
        contributions: [{ date: "2024-01-01", count: 1, level: 1.5 }],
      }),
    ).toThrow();
  });
});

describe("hasBricks", () => {
  it("returns true when at least one cell has level >= 1", () => {
    const grid = {
      username: "octocat",
      total: 2,
      weeks: [[{ date: "2024-01-01", count: 2, level: 1 as const }]],
    };
    expect(hasBricks(grid)).toBe(true);
  });

  it("returns false when every cell is level 0", () => {
    const grid = {
      username: "octocat",
      total: 0,
      weeks: [
        [
          { date: "2024-01-01", count: 0, level: 0 as const },
          { date: "2024-01-02", count: 0, level: 0 as const },
        ],
      ],
    };
    expect(hasBricks(grid)).toBe(false);
  });

  it("returns false for an empty grid", () => {
    expect(hasBricks({ username: "octocat", total: 0, weeks: [] })).toBe(false);
  });
});

describe("fetchGrid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws UserNotFoundError on a 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(fetchGrid("no-such-user")).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("throws ContributionFetchError on a non-2xx, non-404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(fetchGrid("someone")).rejects.toBeInstanceOf(ContributionFetchError);
  });

  it("throws ContributionFetchError when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(fetchGrid("someone")).rejects.toBeInstanceOf(ContributionFetchError);
  });

  it("resolves to a ContributionGrid on a valid response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(VALID_RESPONSE), { status: 200 })),
    );
    const grid = await fetchGrid("octocat");
    expect(grid.username).toBe("octocat");
    expect(grid.total).toBe(3);
    expect(hasBricks(grid)).toBe(true);
  });
});
