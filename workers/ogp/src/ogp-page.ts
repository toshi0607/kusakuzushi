/**
 * The HTML page served to crawlers at `/share/{user}` — carries OGP/Twitter
 * card meta tags only. Human visitors never see this: `isCrawlerUserAgent`
 * gates it, everyone else gets a 302 to the app instead.
 */

import { escapeHtml } from "./html-escape";

const SITE_URL = "https://kusakuzushi.toshi0607.com";

/** The canonical share URL for `user`'s result — matches `apps/web`'s `buildShareUrl`. */
export function buildShareUrl(user: string, score: number, percentage: number): string {
  const params = new URLSearchParams({ s: String(score), p: String(percentage) });
  return `${SITE_URL}/share/${encodeURIComponent(user)}?${params.toString()}`;
}

/** The `/share/{user}/og.png` URL this Worker itself serves for the OGP image. */
export function buildOgImageUrl(user: string, score: number, percentage: number): string {
  const params = new URLSearchParams({ s: String(score), p: String(percentage) });
  return `${SITE_URL}/share/${encodeURIComponent(user)}/og.png?${params.toString()}`;
}

/** Builds the crawler-facing OGP/Twitter-card HTML for `user`'s share card. */
export function buildOgpHtml(user: string, score: number, percentage: number): string {
  const title = `${user} の草を ${percentage}% 刈り取った🌱`;
  const description = `スコア ${score.toLocaleString("en-US")} — 草崩し: GitHub の草ブロック崩し`;
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
