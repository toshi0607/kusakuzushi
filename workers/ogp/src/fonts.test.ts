import { CLEAR_MESSAGES } from "@kusakuzushi/core/clear-message";
import { describe, expect, it } from "vitest";

import { FONT_TEXT } from "./fonts";
import { buildOgImageHtml } from "./og-image-html";

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

  it("covers the result phrase, the score label and the digits and punctuation of a request", () => {
    // #given the result phrase, score label, and request digits/punctuation
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set("の草を % 刈り取った" + "スコア " + "0123456789%,.- ")].filter(
      (char) => !covered.has(char),
    );
    // #then
    expect(missing).toEqual([]);
  });

  it("covers every character of the product line", () => {
    // #given the wordmark, invitation, and host printed on the card
    const covered = new Set(FONT_TEXT);
    // #when
    const missing = [...new Set("草崩し" + "あなたの GitHub の草も刈れる" + "kusakuzushi.toshi0607.com")].filter(
      (char) => !covered.has(char),
    );
    // #then
    expect(missing).toEqual([]);
  });

  it.each([
    {
      name: "no-taunt card",
      input: { user: "toshi0607", score: 1234567, percentage: 56, gridSvgDataUri: null, taunt: null },
    },
    {
      name: "score-less card",
      input: { user: "octo-cat", score: null, percentage: 87, gridSvgDataUri: null },
    },
    {
      name: "card with a grid",
      input: { user: "toshi0607", score: 1234, percentage: 56, gridSvgDataUri: "data:image/svg+xml;base64,AAAA", taunt: null },
    },
    {
      name: "score-less cleared card",
      input: { user: "toshi0607", score: null, percentage: 100, gridSvgDataUri: null, taunt: CLEAR_MESSAGES[0] },
    },
    ...CLEAR_MESSAGES.map((message) => ({
      name: `cleared card: ${message}`,
      input: {
        user: "toshi0607",
        score: 1234,
        percentage: 100,
        gridSvgDataUri: null,
        taunt: message,
      },
    })),
  ])("covers every character the $name prints", ({ input }) => {
    // #given every supported result variant and each clear message
    const covered = new Set(FONT_TEXT);
    // #when
    const html = buildOgImageHtml(input);
    const text = html.replace(/<[^>]*>/g, "").replace(/\n/g, "");
    const missing = [...new Set(text)].filter((char) => !covered.has(char));
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
