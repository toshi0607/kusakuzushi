/**
 * Builds the satori-compatible HTML string for the 1200x630 OGP image.
 * Plain string templating (not JSX) — `workers-og`'s `ImageResponse` accepts
 * an HTML string directly and parses it via `HTMLRewriter`. Every satori
 * flex container needs an explicit `display:flex`.
 */

import { escapeHtml } from "./html-escape";

const BACKGROUND_COLOR = "#0d1117";
const TEXT_COLOR = "#e6edf3";
const ACCENT_COLOR = "#39d353";
const SITE_LABEL = "kusakuzushi.toshi0607.com";

export type OgImageHtmlInput = {
  user: string;
  /**
   * null のときはスコア行を描かない。拡張からの共有は `s` を持たない
   * (apps/extension/src/adapter.ts — スコアの桁が web と揃わない)ので、
   * 0 を焼き付けるより行そのものを落とす。
   */
  score: number | null;
  percentage: number;
  /** A `data:image/svg+xml` URI, or null when the contribution grid could not be fetched. */
  gridSvgDataUri: string | null;
  /**
   * The clear screen's taunt, or null when the round wasn't a full clear (or
   * the year's total couldn't be fetched). Same line the player saw in-app.
   */
  taunt?: string | null;
};

/** Builds the OGP image's satori HTML. `gridSvgDataUri` may be null (fetch failure fallback: no grid). */
export function buildOgImageHtml(input: OgImageHtmlInput): string {
  const user = escapeHtml(input.user);
  const percentage = escapeHtml(String(input.percentage));

  // 53 weeks render at 739x95; scale proportionally to the 1088px content width.
  const gridSection = input.gridSvgDataUri
    ? `<img src="${escapeHtml(input.gridSvgDataUri)}" style="width:1088px; height:140px;" />`
    : "";

  // 完全刈り取りの回は、アプリ・保存画像と同じ主従にする(DESIGN-VISUAL §3):
  // 誰が何%かは文脈として小さく、煽り文が主役。タイムラインで最初に読まれる
  // 1 行が「の草を 100% 刈り取った」だと、どのブロック崩しでも成立してしまう。
  // 30 字 x 34px = 1020px でコンテンツ幅 1088px に 1 行で収まる。
  const resultLine = input.taunt
    ? `<div style="display:flex; flex-wrap:wrap; font-size:26px; line-height:1.4; color:${TEXT_COLOR}; opacity:0.7;">
      <span style="display:flex; font-weight:700;">${user}</span>
      <span style="display:flex; margin-left:12px;">の草を ${percentage}% 刈り取った</span>
    </div>
    <div style="display:flex; font-size:34px; line-height:1.35; color:${TEXT_COLOR}; margin-top:14px;">${escapeHtml(input.taunt)}</div>`
    : `<div style="display:flex; flex-wrap:wrap; font-size:48px; line-height:1.4; color:${TEXT_COLOR};">
      <span style="display:flex; font-weight:700;">${user}</span>
      <span style="display:flex; margin-left:14px;">の草を ${percentage}% 刈り取った</span>
    </div>`;

  // No HTML entities (&nbsp; etc.): workers-og's HTMLRewriter parser passes
  // them to satori as literal text. Spacing between spans uses margins, and
  // spaces inside a text node are plain U+0020.
  const scoreLine =
    input.score === null
      ? ""
      : `<div style="display:flex; font-size:${input.taunt ? 30 : 40}px; color:${ACCENT_COLOR}; margin-top:20px;">スコア ${escapeHtml(input.score.toLocaleString("en-US"))}</div>`;

  return `<div style="display:flex; flex-direction:column; width:1200px; height:630px; padding:56px; background:${BACKGROUND_COLOR}; font-family:'Noto Sans JP';">
  <div style="display:flex;">${gridSection}</div>
  <div style="display:flex; flex-direction:column; flex:1; justify-content:center;">
    ${resultLine}
    ${scoreLine}
  </div>
  <div style="display:flex; justify-content:flex-end;">
    <span style="display:flex; font-size:22px; color:${TEXT_COLOR};">${SITE_LABEL}</span>
  </div>
</div>`;
}
