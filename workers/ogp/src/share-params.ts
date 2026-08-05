/**
 * Validates and normalizes the inputs carried by `/share/{user}` requests.
 * Kept dependency-free (no fetch/DOM) so it can be unit tested directly and
 * reused by both the HTML and PNG handlers.
 */

/** GitHub's own username charset: letters, digits, hyphen; 1-39 characters. */
const GITHUB_USERNAME_PATTERN = /^[a-zA-Z0-9-]{1,39}$/;

/** Digits-only integer string (no sign, no decimal point). */
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

/** Optionally-signed integer string. */
const SIGNED_INTEGER_PATTERN = /^-?\d+$/;

export type ShareParams = {
  user: string;
  /** null = このリンクはスコアを共有していない(`parseScore` 参照)。 */
  score: number | null;
  percentage: number;
};

/** True if `user` matches GitHub's username charset. */
export function isValidGithubUsername(user: string): boolean {
  return GITHUB_USERNAME_PATTERN.test(user);
}

/**
 * Parses the `s` (score) query param: any non-negative integer.
 *
 * 欠けている / 壊れているときは 0 ではなく null を返し、カードはスコア行その
 * ものを出さない。拡張の共有リンクは `s` を持たない(拡張のスコアは web と桁が
 * 違うので載せない — apps/extension/src/adapter.ts)ので、0 で埋めると
 * 「100% 刈り取ってスコア 0」という嘘のカードになる。
 */
export function parseScore(raw: string | null): number | null {
  if (raw === null || !NON_NEGATIVE_INTEGER_PATTERN.test(raw)) {
    return null;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Parses the `p` (percentage) query param and clamps it to 0-100; missing or malformed falls back to 0. */
export function parsePercentage(raw: string | null): number {
  if (raw === null || !SIGNED_INTEGER_PATTERN.test(raw)) {
    return 0;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

/**
 * Parses the full set of `/share/{user}` inputs. Returns `null` when `user`
 * fails GitHub's username charset check — callers should respond 404 in
 * that case rather than rendering a card for an impossible username.
 */
export function parseShareParams(user: string, searchParams: URLSearchParams): ShareParams | null {
  if (!isValidGithubUsername(user)) {
    return null;
  }

  return {
    user,
    score: parseScore(searchParams.get("s")),
    percentage: parsePercentage(searchParams.get("p")),
  };
}
