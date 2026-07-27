/**
 * The one-liner shown under the clear heading. It is the only place in the
 * product that reacts to *how much* grass the player just wiped out: the
 * heading, the score and the harvest bar all say the same thing whether the
 * board held 40 contributions or 4,000.
 *
 * Tiers key off the year's total contribution count (`ContributionGrid.total`)
 * rather than the destroyed-brick count, because on a clear every brick is
 * destroyed by definition — the total IS what the player lost.
 */

type ClearMessageTier = {
  /** Applies to totals at or above this value. Tiers are ordered descending. */
  readonly minTotal: number;
  readonly message: string;
};

/**
 * Nothing here is congratulatory: the joke of the game is that clearing the
 * board means erasing a year of someone's work, so the copy gets colder as
 * there is more of it to erase.
 */
const CLEAR_MESSAGE_TIERS: readonly ClearMessageTier[] = [
  { minTotal: 3000, message: "地道に積み上げてきたものが崩れ去っていく気分はいかがですか？" },
  { minTotal: 1500, message: "1年ぶんの精進が、まとめて更地になりました。" },
  { minTotal: 500, message: "毎日コツコツ積み上げた緑が、きれいに消えました。" },
  { minTotal: 100, message: "ひと通り刈り終えました。跡形もありません。" },
];

/** Fallback for sparse years — too little grass to be worth a jab. */
const SPARSE_MESSAGE = "この量なら、来週にはもう生え揃っていますよ。";

/**
 * Every line `clearMessageFor` can return.
 *
 * Exported because a renderer may need to know the copy up front: the OGP
 * Worker subsets its font by character (`workers/ogp/src/fonts.ts`), and a
 * character missing from that subset renders as tofu. Building the subset
 * from this array is what keeps it from drifting when the copy changes.
 */
export const CLEAR_MESSAGES: readonly string[] = [
  ...CLEAR_MESSAGE_TIERS.map((tier) => tier.message),
  SPARSE_MESSAGE,
];

/**
 * Picks the clear-screen one-liner for a year holding `totalContributions`
 * contributions. Totals below the lowest tier (including 0 and, defensively,
 * negatives) get `SPARSE_MESSAGE`.
 */
export function clearMessageFor(totalContributions: number): string {
  const tier = CLEAR_MESSAGE_TIERS.find(({ minTotal }) => totalContributions >= minTotal);
  return tier?.message ?? SPARSE_MESSAGE;
}
