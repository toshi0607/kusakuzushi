import { describe, expect, it } from "vitest";
import { isValidGithubUsername, parsePercentage, parseScore, parseShareParams } from "./share-params";

describe("isValidGithubUsername", () => {
  it("accepts letters, digits, and hyphens", () => {
    // #given / #when / #then
    expect(isValidGithubUsername("toshi0607")).toBe(true);
    expect(isValidGithubUsername("a")).toBe(true);
    expect(isValidGithubUsername("a-b-C-9")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidGithubUsername("")).toBe(false);
  });

  it("rejects a username longer than 39 characters", () => {
    // #given 40 characters
    const tooLong = "a".repeat(40);
    // #when / #then
    expect(isValidGithubUsername(tooLong)).toBe(false);
  });

  it("accepts a username of exactly 39 characters", () => {
    const maxLength = "a".repeat(39);
    expect(isValidGithubUsername(maxLength)).toBe(true);
  });

  it("rejects characters outside the GitHub username charset", () => {
    // #given usernames containing path/query-breaking or unicode characters
    // #when / #then
    expect(isValidGithubUsername("a/b")).toBe(false);
    expect(isValidGithubUsername("a b")).toBe(false);
    expect(isValidGithubUsername("a_b")).toBe(false);
    expect(isValidGithubUsername("日本語")).toBe(false);
  });
});

describe("parseScore", () => {
  it("parses a valid non-negative integer string", () => {
    expect(parseScore("12340")).toBe(12340);
  });

  it("parses zero", () => {
    expect(parseScore("0")).toBe(0);
  });

  it("is null when missing, so the card omits the score line instead of showing 0", () => {
    // #given no `s` param — 拡張からの共有リンクがこれ
    // #when / #then
    expect(parseScore(null)).toBeNull();
  });

  it("is null for a negative number", () => {
    expect(parseScore("-5")).toBeNull();
  });

  it("is null for a non-numeric string", () => {
    expect(parseScore("abc")).toBeNull();
  });

  it("is null for a decimal string", () => {
    expect(parseScore("12.5")).toBeNull();
  });
});

describe("parsePercentage", () => {
  it("parses a valid percentage within range", () => {
    expect(parsePercentage("87")).toBe(87);
  });

  it("falls back to 0 when missing", () => {
    // #given no `p` param
    // #when / #then
    expect(parsePercentage(null)).toBe(0);
  });

  it("clamps a negative percentage to 0", () => {
    expect(parsePercentage("-5")).toBe(0);
  });

  it("clamps a percentage above 100 to 100", () => {
    // #given p=101
    // #when / #then
    expect(parsePercentage("101")).toBe(100);
  });

  it("falls back to 0 for a non-numeric string", () => {
    expect(parsePercentage("abc")).toBe(0);
  });
});

describe("parseShareParams", () => {
  it("parses all fields for a valid request", () => {
    // #given
    const search = new URLSearchParams({ s: "12340", p: "87" });
    // #when
    const params = parseShareParams("toshi0607", search);
    // #then
    expect(params).toEqual({ user: "toshi0607", score: 12340, percentage: 87 });
  });

  it("defaults score and percentage when both query params are absent", () => {
    // #given no s/p params
    const search = new URLSearchParams();
    // #when
    const params = parseShareParams("toshi0607", search);
    // #then スコアは「共有されていない」(null)、率は 0
    expect(params).toEqual({ user: "toshi0607", score: null, percentage: 0 });
  });

  it("keeps the percentage when only `s` is absent (the extension's share link)", () => {
    // #given 拡張の共有リンク: 率だけを載せる
    const search = new URLSearchParams({ p: "87" });
    // #when
    const params = parseShareParams("toshi0607", search);
    // #then
    expect(params).toEqual({ user: "toshi0607", score: null, percentage: 87 });
  });

  it("returns null for an invalid username", () => {
    // #given
    const search = new URLSearchParams({ s: "1", p: "1" });
    // #when / #then
    expect(parseShareParams("a/b", search)).toBeNull();
  });
});
