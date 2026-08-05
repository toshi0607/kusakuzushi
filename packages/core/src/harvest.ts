/**
 * 刈り取り率 — リザルトと共有文が「どれだけ刈ったか」を言うときの唯一の式。
 *
 * ブロックの数ではなく `count` の合計で数える(1 日 40 contributions の濃い草
 * と 1 の薄い草を同じ 1 個として扱うと、率が盤面の重さを表さなくなる)。
 * 分子・分母が同じ重みなので、count が実数の web でも合成値(level²)の拡張でも
 * 率としては同じ意味を持つ — 詰まるところ「盤面の何割を消したか」。
 */

import type { Brick } from "./game";

/** `Game` そのものではなくこの形だけを要求する(テストが盤面を直接書けるように)。 */
export type HarvestSource = {
  readonly liveBricks: readonly Brick[];
};

/** Sum of `count` over bricks the player has already destroyed. */
export function harvestedCount(source: HarvestSource): number {
  let sum = 0;
  for (const brick of source.liveBricks) {
    if (!brick.alive) sum += brick.count;
  }
  return sum;
}

/**
 * 刈り取り率(0-100 の整数)。`total` は盤面の `count` 合計
 * (= `ContributionGrid.total`)。
 *
 * floor なので、1 ブロックでも残っていれば 100 にはならない — 100% と clear が
 * 同値であることに OGP カード側が依存している(workers/ogp の `renderOgImage`)。
 */
export function harvestPercentage(source: HarvestSource, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((harvestedCount(source) / total) * 100);
}
