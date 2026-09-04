import { describe, expect, it } from "vitest";

import { isValidGithubUsername } from "./github-username";

describe("isValidGithubUsername", () => {
  it("accepts GitHub's charset within 1-39 characters", () => {
    expect(isValidGithubUsername("toshi0607")).toBe(true);
    expect(isValidGithubUsername("a")).toBe(true);
    expect(isValidGithubUsername("x".repeat(39))).toBe(true);
    expect(isValidGithubUsername("with-hyphen")).toBe(true);
  });

  it("rejects other characters, lengths, and non-strings", () => {
    for (const value of ["", "x".repeat(40), "not_valid", "a b", "a/b", "../etc", "<img>", 42, null, undefined, {}]) {
      expect(isValidGithubUsername(value)).toBe(false);
    }
  });
});
