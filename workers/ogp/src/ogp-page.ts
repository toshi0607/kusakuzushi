/**
 * The HTML page served to crawlers at `/share/{user}` — carries OGP/Twitter
 * card meta tags only. Human visitors never see this: `isCrawlerUserAgent`
 * gates it, everyone else gets a 302 to the app instead.
 */

import { escapeHtml } from "./html-escape";

const SITE_URL = "https://kusakuzushi.toshi0607.com";

/**
 * `s`/`p` のクエリ。`score` が null(このリンクはスコアを共有していない)なら
 * `s` を落とす — 0 を書き足すと、受け取り側にはスコア 0 の共有と区別が付かない。
 */
function shareQuery(score: number | null, percentage: number): string {
  const params = new URLSearchParams();
  if (score !== null) params.set("s", String(score));
  params.set("p", String(percentage));
  return params.toString();
}

/** The canonical share URL for `user`'s result — matches core's `buildShareUrl`. */
export function buildShareUrl(user: string, score: number | null, percentage: number): string {
  return `${SITE_URL}/share/${encodeURIComponent(user)}?${shareQuery(score, percentage)}`;
}

/** The `/share/{user}/og.png` URL this Worker itself serves for the OGP image. */
export function buildOgImageUrl(user: string, score: number | null, percentage: number): string {
  return `${SITE_URL}/share/${encodeURIComponent(user)}/og.png?${shareQuery(score, percentage)}`;
}

/** Builds the crawler-facing OGP/Twitter-card HTML for `user`'s share card. */
export function buildOgpHtml(user: string, score: number | null, percentage: number): string {
  const title = `${user} の草を ${percentage}% 刈り取った🌱`;
  // スコアを共有していないリンク(拡張から)では、説明文も名乗りだけにする。
  const description =
    score === null
      ? "草崩し: GitHub の草ブロック崩し"
      : `スコア ${score.toLocaleString("en-US")} — 草崩し: GitHub の草ブロック崩し`;
  const shareUrl = buildShareUrl(user, score, percentage);
  const imageUrl = buildOgImageUrl(user, score, percentage);

  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedShareUrl = escapeHtml(shareUrl);
  const escapedImageUrl = escapeHtml(imageUrl);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>${escapedTitle}</title>
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:image" content="${escapedImageUrl}" />
    <!-- 寸法を明示しておくと、画像を取得する前に large card レイアウトが確定する。 -->
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${escapedShareUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="草崩し" />
    <meta property="og:locale" content="ja_JP" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapedImageUrl}" />
  </head>
  <body>
    <a href="${SITE_URL}/?user=${encodeURIComponent(user)}">${escapedTitle} — 草崩しをプレイ</a>
  </body>
</html>
`;
}
