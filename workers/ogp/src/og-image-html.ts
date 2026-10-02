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
// Same value as core's MARQUEE_COLOR, repeated here because it is only exported
// from the package root, which re-exports renderer.ts and its DOM types and cannot
// be imported in a Worker (see the comment at the top of og-image.ts).
const WORDMARK_COLOR = "#ffb224";
const RULE_COLOR = "#30363d";
export const WORDMARK = "草崩し";
export const INVITATION = "あなたの GitHub の草も刈れる";
export const SITE_LABEL = "kusakuzushi.toshi0607.com";

function resultPhrase(percentage: string): string {
  return `の草を ${percentage}% 刈り取った`;
}

function scoreLabel(score: string): string {
  return `スコア ${score}`;
}

/**
 * Every character the template itself prints whatever the request. fonts.ts
 * builds the font subset from this: a character the card prints but the subset
 * lacks renders as tofu with no error and a 200 response.
 */
export const CARD_FIXED_TEXT = resultPhrase("") + scoreLabel("") + WORDMARK + INVITATION + SITE_LABEL;

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
      <span style="display:flex; margin-left:12px;">${resultPhrase(percentage)}</span>
    </div>
    <div style="display:flex; font-size:34px; line-height:1.35; color:${TEXT_COLOR}; margin-top:14px;">${escapeHtml(input.taunt)}</div>`
    : `<div style="display:flex; flex-wrap:wrap; font-size:48px; line-height:1.4; color:${TEXT_COLOR};">
      <span style="display:flex; font-weight:700;">${user}</span>
      <span style="display:flex; margin-left:14px;">${resultPhrase(percentage)}</span>
    </div>`;

  // No HTML entities (&nbsp; etc.): workers-og's HTMLRewriter parser passes
  // them to satori as literal text. Spacing between spans uses margins, and
  // spaces inside a text node are plain U+0020.
  const scoreLine =
    input.score === null
      ? ""
      : `<div style="display:flex; font-size:${input.taunt ? 30 : 40}px; color:${ACCENT_COLOR}; margin-top:20px;">${scoreLabel(escapeHtml(input.score.toLocaleString("en-US")))}</div>`;

  // On X the link card is mostly this image: the product line says what it is
  // (wordmark), that the viewer can play too (invitation), and where to go (host).
  // The order matches the saved result image (apps/web/src/share.ts, DESIGN-VISUAL.md §8).
  // The rule separates the result (who / how much) from the product line.
  // The left group grows (flex:1) so the host reaches the rule's right end,
  // the same way the result block above uses flex:1. Avoid justify-content:space-between:
  // this satori build (workers-og 0.0.27) puts free space at both ends as well.
  // Measured on the real PNG on 2026-10-02: the 1088px row was inset 54px on
  // the left and 60px on the right, with 109px between the two items;
  // width:100% on the row did not change that.
  return `<div style="display:flex; flex-direction:column; width:1200px; height:630px; padding:56px; background:${BACKGROUND_COLOR}; font-family:'Noto Sans JP';">
  <div style="display:flex;">${gridSection}</div>
  <div style="display:flex; flex-direction:column; flex:1; justify-content:center;">
    ${resultLine}
    ${scoreLine}
  </div>
  <div style="display:flex; height:2px; background:${RULE_COLOR};"></div>
  <div style="display:flex; align-items:center; margin-top:16px;">
    <div style="display:flex; flex:1; align-items:center;">
      <span style="display:flex; font-size:36px; font-weight:700; color:${WORDMARK_COLOR};">${WORDMARK}</span>
      <span style="display:flex; margin-left:24px; font-size:28px; color:${TEXT_COLOR};">${INVITATION}</span>
    </div>
    <span style="display:flex; font-size:28px; color:${WORDMARK_COLOR};">${SITE_LABEL}</span>
  </div>
</div>`;
}
