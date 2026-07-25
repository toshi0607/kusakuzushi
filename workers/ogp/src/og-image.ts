/**
 * Orchestrates the OGP PNG render: fetches the contribution grid, folds and
 * renders it to SVG, loads fonts, and calls `workers-og`'s `ImageResponse`.
 * Not unit tested directly (it depends on fetch + satori) — the pieces it
 * composes (`foldContributionsIntoWeeks`, `buildContributionGridSvg`,
 * `buildOgImageHtml`) are the tested pure functions.
 */

import { ImageResponse } from "workers-og";
import { parseJogruberContributions } from "./jogruber";
import { foldContributionsIntoWeeks } from "./contribution-grid";
import { buildContributionGridSvg, svgToDataUri } from "./grid-svg";
import { buildOgImageHtml } from "./og-image-html";
import { loadOgFonts } from "./fonts";

const JOGRUBER_API_BASE = "https://github-contributions-api.jogruber.de/v4";
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;

/**
 * Fetches the contribution grid and renders it to a `data:image/svg+xml` URI.
 * Returns null on any failure (network error, non-2xx, malformed payload, or
 * an empty grid) so the caller can fall back to a grid-less card — a broken
 * image is worse than one missing a decorative grid.
 */
async function fetchGridSvgDataUri(user: string): Promise<string | null> {
  try {
    const response = await fetch(`${JOGRUBER_API_BASE}/${encodeURIComponent(user)}?y=last`);
    if (!response.ok) {
      return null;
    }

    const json: unknown = await response.json();
    const contributions = parseJogruberContributions(json);
    const weeks = foldContributionsIntoWeeks(contributions);
    if (weeks.length === 0) {
      return null;
    }

    return svgToDataUri(buildContributionGridSvg(weeks));
  } catch {
    return null;
  }
}

export type OgImageRender = {
  response: Response;
  /** False when the grid fetch failed and the card fell back to a grid-less
   * layout — the caller caches those briefly so a transient jogruber outage
   * does not pin a degraded card for a full day. */
  gridIncluded: boolean;
};

/** Renders the 1200x630 OGP PNG for `user`'s share card. */
export async function renderOgImage(user: string, score: number, percentage: number): Promise<OgImageRender> {
  const [gridSvgDataUri, fonts] = await Promise.all([fetchGridSvgDataUri(user), loadOgFonts()]);
  const html = buildOgImageHtml({ user, score, percentage, gridSvgDataUri });
  return {
    response: new ImageResponse(html, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, fonts }),
    gridIncluded: gridSvgDataUri !== null,
  };
}
