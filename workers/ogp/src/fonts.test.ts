import { CLEAR_MESSAGES } from "@kusakuzushi/core/clear-message";
import { describe, expect, it } from "vitest";

import { FONT_TEXT } from "./fonts";

/**
 * The font is fetched as a `text=`-subset from Google Fonts, so a character
 * the card prints but the subset omits renders as an empty box. Nothing else
 * fails — the PNG is still 200 — so this is the only cheap guard there is.
 */
describe("FONT_TEXT", () => {
  it("covers every character of every clear message", () => {
    // #given the copy the card can print
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set(CLEAR_MESSAGES.join(""))].filter((char) => !covered.has(char));
    // #then
    expect(missing).toEqual([]);
  });

  it("covers the card's own fixed strings", () => {
    // #given the result phrase, the site label and the digits/punctuation
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set("の草を刈り取ったスコア草崩kusakuzushi.toshi0607.com0123456789%,.- ")].filter(
      (char) => !covered.has(char),
    );
    // #then
    expect(missing).toEqual([]);
  });

  it("lists each character once, so the request URL stays as short as it can", () => {
    // #given / #when
    const unique = new Set(FONT_TEXT);
    // #then
    expect(unique.size).toBe(FONT_TEXT.length);
  });
});
