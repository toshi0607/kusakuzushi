/**
 * index.html fetches DotGothic16 as a `text=` subset (a deliberate perf
 * choice — see the comment above the link). A character the display face is
 * asked to draw but the subset omits falls back to IBM Plex Sans JP without
 * any error, so the only cheap guard is checking the copy against the URL.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CLEAR_MESSAGES } from "@kusakuzushi/core";
import { describe, expect, it } from "vitest";

const INDEX_HTML = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

/** Every `text=` param of a DotGothic16 stylesheet link (the async one and the noscript fallback). */
function displayFontSubsets(): string[] {
  const matches = [...INDEX_HTML.matchAll(/family=DotGothic16&display=swap&text=([^"]+)/g)];
  return matches.map((match) => decodeURIComponent(match[1]));
}

describe("DotGothic16 subset", () => {
  it("is requested by every stylesheet link that needs it", () => {
    // #given the async link plus the noscript fallback
    // #when / #then
    expect(displayFontSubsets()).toHaveLength(2);
  });

  it("covers every character of every clear taunt", () => {
    // #given the taunts are set in the display face (DESIGN-VISUAL §3)
    const taunted = [...new Set(CLEAR_MESSAGES.join(""))];
    // #when
    for (const subset of displayFontSubsets()) {
      const covered = new Set(subset);
      // #then
      expect(taunted.filter((char) => !covered.has(char))).toEqual([]);
    }
  });

  it("asks both links for the same glyphs", () => {
    // #given / #when
    const [asyncLink, noscriptLink] = displayFontSubsets();
    // #then a noscript visitor must not get a different face
    expect(asyncLink).toBe(noscriptLink);
  });
});
