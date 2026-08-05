/**
 * 共有リンクと X 投稿文の組み立て。web(apps/web)と拡張(apps/extension)の
 * 両方がここを通るので、ハッシュタグと `/share/{user}` の形はこのファイルが
 * 唯一の出所になる。
 *
 * clear-message.ts と同じ理由で core に置いてある: 文言と共有の形は両アプリで
 * 揃っていないと意味がない。DOM にも fetch にも依存しない。
 */

const SITE_URL = "https://kusakuzushi.toshi0607.com";

/** 投稿文の末尾に必ず付くタグ。web / 拡張どちらの共有もこれで辿れる。 */
export const SHARE_HASHTAG = "#草崩し";

/**
 * The canonical share URL for `username`'s result. Served by the OGP Worker
 * (`workers/ogp`): crawlers get OGP-tagged HTML whose image reflects the
 * score/percentage carried in `s`/`p`, humans get redirected to the app.
 *
 * `score` を省くと `s` が付かない。Worker 側はそれを「スコア 0」ではなく
 * 「スコア行を出さない」として扱う(workers/ogp の `parseScore`)。
 */
export function buildShareUrl(username: string, percentage: number, score?: number): string {
  const params = new URLSearchParams();
  // `s` を先に積むのは既存の共有 URL とバイト一致させるため(キャッシュ済みの
  // OGP カードを取り直させない)。Worker は名前で読むので順序自体に意味はない。
  if (score !== undefined) params.set("s", String(score));
  params.set("p", String(percentage));
  return `${SITE_URL}/share/${encodeURIComponent(username)}?${params.toString()}`;
}

function buildPostIntentUrl(text: string, shareUrl: string): string {
  const params = new URLSearchParams({ text, url: shareUrl });
  return `https://x.com/intent/post?${params.toString()}`;
}

/**
 * Builds an `x.com/intent/post` URL announcing `username`'s harvest result.
 * web 版用 — 実 contributions 数とスコアの両方を持っているのは web だけ。
 */
export function buildIntentUrl(username: string, totalContributions: number, percentage: number, score: number): string {
  const text = `${username} の草 ${totalContributions.toLocaleString("en-US")} contributions を ${percentage}% 刈り取った🌱 スコア ${score.toLocaleString("en-US")} ${SHARE_HASHTAG}`;
  return buildPostIntentUrl(text, buildShareUrl(username, percentage, score));
}

/**
 * 拡張のリザルトから X に流す投稿文。刈り取り率だけを載せる。
 *
 * web と同じ文面にできない理由は 2 つあり、どちらも apps/extension/src/adapter.ts
 * の「GitHub の DOM は日ごとの contribution 数を持たない」に行き着く:
 * - 拡張のスコアは合成 count(level²)由来なので、実 contributions から出る
 *   web のスコアとは桁が違う。同じタグに並べると比較できない数字が 2 種類
 *   混ざる。
 * - 同じ理由で `ContributionGrid.total` も contributions 数ではないため、
 *   「N contributions」と書けない(実数はページの見出しからしか読めず、
 *   読めない回もある)。
 *
 * 刈り取り率は分子・分母が同じ重みなので、これだけは両者で同じ意味を持つ。
 */
export function buildHarvestIntentUrl(username: string, percentage: number): string {
  const text = `${username} の草を GitHub 上で ${percentage}% 刈り取った🌱 ${SHARE_HASHTAG}`;
  return buildPostIntentUrl(text, buildShareUrl(username, percentage));
}
