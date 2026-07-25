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
  score: number;
  percentage: number;
  /** A `data:image/svg+xml` URI, or null when the contribution grid could not be fetched. */
  gridSvgDataUri: string | null;
};

/** Builds the OGP image's satori HTML. `gridSvgDataUri` may be null (fetch failure fallback: no grid). */
export function buildOgImageHtml(input: OgImageHtmlInput): string {
  const user = escapeHtml(input.user);
  const score = escapeHtml(input.score.toLocaleString("en-US"));
  const percentage = escapeHtml(String(input.percentage));

  // 53 weeks render at 739x95; scale proportionally to the 1088px content width.
  const gridSection = input.gridSvgDataUri
    ? `<img src="${escapeHtml(input.gridSvgDataUri)}" style="width:1088px; height:140px;" />`
    : "";

  // No HTML entities (&nbsp; etc.): workers-og's HTMLRewriter parser passes
  // them to satori as literal text. Spacing between spans uses margins, and
  // spaces inside a text node are plain U+0020.
  return `<div style="display:flex; flex-direction:column; width:1200px; height:630px; padding:56px; background:${BACKGROUND_COLOR}; font-family:'Noto Sans JP';">
  <div style="display:flex;">${gridSection}</div>
  <div style="display:flex; flex-direction:column; flex:1; justify-content:center;">
    <div style="display:flex; flex-wrap:wrap; font-size:48px; line-height:1.4; color:${TEXT_COLOR};">
      <span style="display:flex; font-weight:700;">${user}</span>
      <span style="display:flex; margin-left:14px;">の草を ${percentage}% 刈り取った</span>
    </div>
    <div style="display:flex; font-size:40px; color:${ACCENT_COLOR}; margin-top:20px;">スコア ${score}</div>
  </div>
  <div style="display:flex; justify-content:flex-end;">
    <span style="display:flex; font-size:22px; color:${TEXT_COLOR};">${SITE_LABEL}</span>
  </div>
</div>`;
}
