/**
 * アトラクトモード用の合成グリッド。53x7 の草グラフに 3x5 ピクセル文字で
 * ワードマークを描き、余白に疎な level1 ノイズを撒く。
 * 「草グラフにドット絵を描く」文化(gitfiti 等)への目配せがこの画面の核。
 */

import type { Cell, ContributionGrid } from "@kusakuzushi/core";

const COLS = 53;
const ROWS = 7;
const GLYPH_WIDTH = 3;
const GLYPH_HEIGHT = 5;
/** 文字間の空白列を含めた1文字ぶんの送り幅。 */
const GLYPH_ADVANCE = GLYPH_WIDTH + 1;
const TITLE_TOP_ROW = 1;
const NOISE_DENSITY = 0.12;

export const DEMO_WORD = "KUSAKUZUSHI";

/**
 * 3x5 ピクセルフォント。行が上から下、'1' が草セル。
 * 未定義文字はフォールバックせず throw する(lessons.md 2026-07-25:
 * 黙った代替グリフでワードマークが壊れる事故が実際に起きた)。
 */
const GLYPHS: Record<string, readonly [string, string, string, string, string]> = {
  K: ["101", "101", "110", "101", "101"],
  U: ["101", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
  A: ["010", "101", "111", "101", "101"],
  Z: ["111", "001", "010", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
};

function glyphFor(char: string): readonly string[] {
  const glyph = GLYPHS[char];
  if (!glyph) {
    throw new Error(`demo-grid: glyph not defined for ${JSON.stringify(char)}`);
  }
  return glyph;
}

/** `word` を描いた合成 ContributionGrid を返す。ノイズは文字セルには載らない。 */
export function buildDemoGrid(word: string = DEMO_WORD): ContributionGrid {
  const wordWidth = word.length * GLYPH_ADVANCE - 1;
  if (wordWidth > COLS) {
    throw new Error(`demo-grid: "${word}" (${wordWidth} cols) does not fit in ${COLS} cols`);
  }
  const originCol = Math.floor((COLS - wordWidth) / 2);

  const levels: number[][] = [];
  for (let col = 0; col < COLS; col++) {
    levels.push(new Array<number>(ROWS).fill(0));
  }

  for (let i = 0; i < word.length; i++) {
    const glyph = glyphFor(word[i]);
    const glyphCol = originCol + i * GLYPH_ADVANCE;
    for (let gr = 0; gr < GLYPH_HEIGHT; gr++) {
      for (let gc = 0; gc < GLYPH_WIDTH; gc++) {
        if (glyph[gr][gc] === "1") {
          // 全セル level4(最も濃い緑)。3/4 の市松で濃淡を付けていたが、
          // セル間に本家と同じ 22% の隙間が入ると 3 セル幅のストロークが
          // ちらついて字形が崩れる。gitfiti の実物も単一レベルのベタ描き。
          levels[glyphCol + gc][TITLE_TOP_ROW + gr] = 4;
        }
      }
    }
  }

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (levels[col][row] === 0 && Math.random() < NOISE_DENSITY) {
        levels[col][row] = 1;
      }
    }
  }

  let total = 0;
  const weeks: Cell[][] = levels.map((weekLevels, col) =>
    weekLevels.map((level, row) => {
      total += level;
      return {
        date: `demo-${col}-${row}`,
        count: level,
        level: level as Cell["level"],
      };
    }),
  );

  return { username: "kusakuzushi", weeks, total };
}
