import { describe, expect, it } from "vitest";

import { clearMessageFor } from "./clear-message";

describe("clearMessageFor", () => {
  it("returns a different line for each tier", () => {
    const messages = [50, 250, 900, 2000, 5000].map(clearMessageFor);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("switches exactly at each threshold", () => {
    for (const threshold of [100, 500, 1500, 3000]) {
      expect(clearMessageFor(threshold)).not.toBe(clearMessageFor(threshold - 1));
      expect(clearMessageFor(threshold)).toBe(clearMessageFor(threshold + 1));
    }
  });

  it("falls back to the sparse line for empty and negative totals", () => {
    expect(clearMessageFor(0)).toBe(clearMessageFor(99));
    expect(clearMessageFor(-1)).toBe(clearMessageFor(99));
  });

  it("never returns an empty string", () => {
    for (const total of [0, 99, 100, 499, 500, 1499, 1500, 2999, 3000, 100000]) {
      expect(clearMessageFor(total).length).toBeGreaterThan(0);
    }
  });
});
