/**
 * Builds the satori-compatible HTML string for the 1200x630 OGP image.
 * Plain string templating (not JSX) — `workers-og`'s `ImageResponse` accepts
 * an HTML string directly and parses it via `HTMLRewriter`. Every satori
 * flex container needs an explicit `display:flex`.
 * Whitespace between sibling elements in the template is not ignored:
 * workers-og keeps each whitespace-only text node, and satori lays it out as
 * a zero-size flex item. Do not distribute space by item count across children
 * written on separate lines (`justify-content:space-between` / `space-around` /
 * `space-evenly`, `gap`); use margins or `flex:1`.
 */

// The `/share-link` subpath, not the package root — see og-image.ts.
// SITE_HOST is the constant the share URL itself is built from, so the host
// printed on the card cannot drift from the link's.
// SHARE_INVITATION is the same constant the saved result image and X post text print.
import { SHARE_INVITATION, SITE_HOST } from "@kusakuzushi/core/share-link";

import { escapeHtml } from "./html-escape";

const BACKGROUND_COLOR = "#0d1117";
const TEXT_COLOR = "#e6edf3";
const ACCENT_COLOR = "#39d353";
// Same name and value as core's MARQUEE_COLOR, repeated here because it is only exported
// from the package root, which re-exports renderer.ts and its DOM types and cannot
// be imported in a Worker (see the comment at the top of og-image.ts).
const MARQUEE_COLOR = "#ffb224";
const RULE_COLOR = "#30363d";
const WORDMARK = "草崩し";

/**
 * X overlays the title at the bottom-left of summary_large_image cards. Measured
 * on x.com on 2026-10-02, on real posts carrying this card: left inset 13px, top
 * 33px above the bottom, height 20px, white 13px text on rgba(0,0,0,0.77), width
 * equal to the title plus 16px (216px for a 22-character title). The label keeps
 * that size on both a 518px desktop card and a 308px card on a 390px phone.
 * In this 1200x630 image, it covers x 30..530 / y 554..600 on desktop and
 * x 51..892 / y 503..581 on the phone. The old bottom product line's text at
 * y 533..567 had its wordmark and invitation completely hidden on the phone
 * and their lower 40% hidden on desktop, so the line moves to the top.
 * 126px of bottom padding keeps the score line ending at y 472 for the cleared
 * card and at y 487 for a gameOver card whose name (21+ characters) wraps the
 * 48px line, above the label zone on a 390px phone (y 503). The 360px phone
 * (label from about y 488) was not measured and is extrapolated from the label
 * keeping its size; there a wrapped name's score line just touches the label.
 */
const X_LABEL_CLEARANCE = 126;

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
 * Add any new literal printed by the template to this constant. fonts.test.ts
 * renders the card variants and fails when a printed character is missing
 * from the subset.
 */
export const CARD_FIXED_TEXT = resultPhrase("") + scoreLabel("") + WORDMARK + SHARE_INVITATION + SITE_HOST;

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
  //
  // gameOver 側の 48px の行は、ユーザー名が 21〜22 字を超えると 2 行に折り返す。
  // 行間 1.4 のままだと、スコア行の下端が y 496 まで下がり、X のラベル(幅 360px
  // 前後のスマホで y 488 から)にかかる。行間を 1.2 にして y 487 に収める。
  // 名前は nowrap にする: ハイフンを含む長い名前はハイフンで折れて 3 行になり、
  // 下の行とスコアが重なって描かれる(2026-10-02 実レンダリングで確認)。
  const resultLine = input.taunt
    ? `<div style="display:flex; flex-wrap:wrap; font-size:26px; line-height:1.4; color:${TEXT_COLOR}; opacity:0.7;">
      <span style="display:flex; font-weight:700;">${user}</span>
      <span style="display:flex; margin-left:12px;">${resultPhrase(percentage)}</span>
    </div>
    <div style="display:flex; font-size:34px; line-height:1.35; color:${TEXT_COLOR}; margin-top:14px;">${escapeHtml(input.taunt)}</div>`
    : `<div style="display:flex; flex-wrap:wrap; font-size:48px; line-height:1.2; color:${TEXT_COLOR};">
      <span style="display:flex; font-weight:700; white-space:nowrap;">${user}</span>
      <span style="display:flex; margin-left:14px;">${resultPhrase(percentage)}</span>
    </div>`;

  // No HTML entities (&nbsp; etc.): workers-og's HTMLRewriter parser passes
  // them to satori as literal text. Spacing between spans uses margins, and
  // spaces inside a text node are plain U+0020.
  const scoreLine =
    input.score === null
      ? ""
      : `<div style="display:flex; font-size:${input.taunt ? 30 : 40}px; color:${ACCENT_COLOR}; margin-top:20px;">${scoreLabel(escapeHtml(input.score.toLocaleString("en-US")))}</div>`;

  // On X the link card is mostly this image: the product line comes first, saying what it is
  // (wordmark), that the viewer can play too (invitation), and where to go (host).
  // The order matches the saved result image (apps/web/src/share.ts, DESIGN-VISUAL.md §8).
  // It sits at the top because X's title label covers the image's bottom-left
  // (see X_LABEL_CLEARANCE). The rule separates it from the grass and the result.
  // The left group grows (flex:1) to push the host to the rule's right end.
  // justify-content:space-between would not do that here: the newlines between
  // the row's children are zero-size flex items (see the file header), so free
  // space is spread over four gaps instead of one. Measured on the real PNG on
  // 2026-10-02: the wordmark started 54px in from the rule's left end and the
  // host ended 60px before its right end, with 109px between them. The same row
  // without whitespace between its children aligns to both ends with space-between.
  return `<div style="display:flex; flex-direction:column; width:1200px; height:630px; padding:56px 56px ${X_LABEL_CLEARANCE}px; background:${BACKGROUND_COLOR}; font-family:'Noto Sans JP';">
  <div style="display:flex; align-items:center;">
    <div style="display:flex; flex:1; align-items:center;">
      <span style="display:flex; font-size:36px; font-weight:700; color:${MARQUEE_COLOR};">${WORDMARK}</span>
      <span style="display:flex; margin-left:24px; font-size:28px; color:${TEXT_COLOR};">${SHARE_INVITATION}</span>
    </div>
    <span style="display:flex; font-size:28px; color:${MARQUEE_COLOR};">${SITE_HOST}</span>
  </div>
  <div style="display:flex; height:2px; margin-top:16px; background:${RULE_COLOR};"></div>
  <div style="display:flex; margin-top:20px;">${gridSection}</div>
  <div style="display:flex; flex-direction:column; flex:1; justify-content:center;">
    ${resultLine}
    ${scoreLine}
  </div>
</div>`;
}
