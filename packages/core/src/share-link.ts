/**
 * 共有リンクと X 投稿文の組み立て。web(apps/web)と拡張(apps/extension)の
 * 両方がここを通るので、ハッシュタグと `/share/{user}` の形はこのファイルが
 * 唯一の出所になる。
 *
 * clear-message.ts と同じ理由で core に置いてある: 文言と共有の形は両アプリで
 * 揃っていないと意味がない。DOM にも fetch にも依存しない。
 */

/**
 * サイトのホスト名。共有 URL の起点であり、保存用のリザルト画像に行き先として
 * 印字する表記でもある(apps/web/src/share.ts)。画像に書く行き先とリンクの
 * 行き先を別々の文字列で持つと、ドメインを変えたときに片方だけ古いまま残る。
 */
export const SITE_HOST = "kusakuzushi.toshi0607.com";

const SITE_URL = `https://${SITE_HOST}`;

/** 投稿文の末尾に必ず付くタグ。web / 拡張どちらの共有もこれで辿れる。 */
export const SHARE_HASHTAG = "#草崩し";

/**
 * 投稿や保存画像を見た人に向けた一言。X の投稿文と、web の保存画像
 * (apps/web/src/share.ts)が同じ文言を使う。
 */
export const SHARE_INVITATION = "あなたの草もどうですか？";

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
 * 結果の 1 行のあとで改行し、誘い文とタグを置く。結果だけの投稿では、見た人に
 * 「自分の草でも遊べる」ことが伝わらない。X は投稿文のあとに共有 URL を続ける
 * ので、誘い文の行の直後がリンクになる。
 */
function withInvitation(resultLine: string): string {
  return `${resultLine}\n${SHARE_INVITATION} ${SHARE_HASHTAG}`;
}

/**
 * Builds an `x.com/intent/post` URL announcing `username`'s harvest result.
 * web 版用 — 実 contributions 数とスコアの両方を持っているのは web だけ。
 */
export function buildIntentUrl(username: string, totalContributions: number, percentage: number, score: number): string {
  return buildPostIntentUrl(
    buildIntentText(username, totalContributions, percentage, score),
    buildShareUrl(username, percentage, score),
  );
}

/** The post body behind `buildIntentUrl`, for callers that show the text itself (the MCP tools do). */
export function buildIntentText(username: string, totalContributions: number, percentage: number, score: number): string {
  return withInvitation(
    `${username} の草 ${totalContributions.toLocaleString("en-US")} contributions を ${percentage}% 刈り取った🌱 スコア ${score.toLocaleString("en-US")}`,
  );
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
  return buildPostIntentUrl(buildHarvestIntentText(username, percentage), buildShareUrl(username, percentage));
}

/** The post body behind `buildHarvestIntentUrl`. */
export function buildHarvestIntentText(username: string, percentage: number): string {
  return withInvitation(`${username} の草を GitHub 上で ${percentage}% 刈り取った🌱`);
}
