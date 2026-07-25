import { describe, expect, it } from "vitest";

import { DEMO_WORD, buildDemoGrid } from "./demo-grid";

const GLYPH_ADVANCE = 4;

/** 3x5 の期待グリフ(demo-grid.ts と独立に定義して写し間違いを検出する)。 */
const EXPECTED: Record<string, readonly string[]> = {
  K: ["101", "101", "110", "101", "101"],
  U: ["101", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  Z: ["111", "001", "010", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
};

describe("buildDemoGrid", () => {
  it("is a full 53x7 grid", () => {
    // #given / #when
    const grid = buildDemoGrid();

    // #then
    expect(grid.weeks).toHaveLength(53);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it("spells every letter of KUSAKUZUSHI with the expected cell pattern", () => {
    // #given the word occupies 43 centred columns starting at col 5, rows 1..5
    const grid = buildDemoGrid();
    const originCol = 5;

    // #when / #then each letter's 3x5 box matches its glyph:
    // on-pixels are strong grass (level 3-4), off-pixels are never letter-strength
    for (let i = 0; i < DEMO_WORD.length; i++) {
      const glyph = EXPECTED[DEMO_WORD[i]];
      expect(glyph, `glyph for ${DEMO_WORD[i]}`).toBeDefined();
      const glyphCol = originCol + i * GLYPH_ADVANCE;
      for (let gr = 0; gr < 5; gr++) {
        for (let gc = 0; gc < 3; gc++) {
          const level = grid.weeks[glyphCol + gc][1 + gr].level;
          const where = `${DEMO_WORD[i]}[${i}] cell (${gr},${gc})`;
          if (glyph[gr][gc] === "1") {
            expect(level, where).toBeGreaterThanOrEqual(3);
          } else {
            expect(level, where).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("keeps noise sparse and out of the letter band's strong levels", () => {
    // #given / #when
    const grid = buildDemoGrid();

    // #then no cell outside the glyphs exceeds level 1
    let strong = 0;
    let noise = 0;
    for (const week of grid.weeks) {
      for (const cell of week) {
        if (cell.level >= 3) strong++;
        if (cell.level === 1) noise++;
      }
    }
    // KUSAKUZUSHI の総オン・ピクセル数(グリフ定義から数えた不変量)
    expect(strong).toBe(114);
    expect(noise).toBeGreaterThan(0);
    expect(noise).toBeLessThan(53 * 7 * 0.3);
  });

  it("throws on a character without a glyph instead of substituting one", () => {
    // #given a word containing an undefined glyph
    // #when / #then building the grid fails loudly (lessons.md 2026-07-25)
    expect(() => buildDemoGrid("KUSAQ")).toThrow(/glyph not defined for "Q"/);
  });

  it("throws when the word cannot fit the 53 columns", () => {
    // #given a 14-letter word (14*4-1 = 55 > 53 cols)
    // #when / #then
    expect(() => buildDemoGrid("KUSAKUZUSHIKUS")).toThrow(/does not fit/);
  });
});
