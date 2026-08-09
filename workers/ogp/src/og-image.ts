/**
 * Orchestrates the OGP PNG render: fetches the contribution grid, folds and
 * renders it to SVG, loads fonts, and calls `workers-og`'s `ImageResponse`.
 * Not unit tested directly (it depends on fetch + satori) — the pieces it
 * composes (`foldContributionsIntoWeeks`, `buildContributionGridSvg`,
 * `buildOgImageHtml`) are the tested pure functions.
 */

// Deliberately the `/clear-message` subpath, not the package root: the root
// re-exports renderer.ts, whose `CanvasRenderingContext2D` types don't exist
// in a Worker's lib (ES2022 + workers-types, no DOM).
import { clearMessageFor } from "@kusakuzushi/core/clear-message";
import { ImageResponse } from "workers-og";
import { parseJogruberContributions } from "./jogruber";
import { foldContributionsIntoWeeks } from "./contribution-grid";
import { buildContributionGridSvg, svgToDataUri } from "./grid-svg";
import { buildOgImageHtml } from "./og-image-html";
import { loadOgFonts } from "./fonts";

const JOGRUBER_API_BASE = "https://github-contributions-api.jogruber.de/v4";
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
// Keep this 64 KiB streaming limit aligned with apps/web/src/api.ts; separate
// bundles retain their own error and fallback behavior.
// A 371-cell response is normally below 32 KiB; 64 KiB leaves room for API
// metadata while keeping an untrusted upstream body inexpensive to parse.
const MAX_RESPONSE_BYTES = 64 * 1024;

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    throw new Error("jogruber response is too large");
  }

  if (!response.body) {
    throw new Error("jogruber response has no body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  let cancelled = false;
  const cancel = async () => {
    if (!cancelled) {
      cancelled = true;
      await reader.cancel();
    }
  };

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await cancel().catch(() => undefined);
        throw new Error("jogruber response is too large");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (!done) {
      await cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

type FetchedGrid = {
  /** A `data:image/svg+xml` URI, or null when the grid could not be fetched. */
  svgDataUri: string | null;
  /** The year's contribution total, or null alongside a failed fetch. */
  total: number | null;
};

const NO_GRID: FetchedGrid = { svgDataUri: null, total: null };

/**
 * Fetches the contribution grid, rendering it to a `data:image/svg+xml` URI
 * and summing the year's total on the way past (the total picks the taunt —
 * the `s`/`p` query params carry the score and percentage, but not this).
 *
 * Returns nulls on any failure (network error, non-2xx, malformed payload, or
 * an empty grid) so the caller can fall back to a grid-less card — a broken
 * image is worse than one missing a decorative grid.
 */
async function fetchGrid(user: string, emptied: boolean): Promise<FetchedGrid> {
  try {
    const response = await fetch(`${JOGRUBER_API_BASE}/${encodeURIComponent(user)}?y=last`);
    if (!response.ok) {
      return NO_GRID;
    }

    const json = await parseJsonResponse(response);
    const contributions = parseJogruberContributions(json);
    const weeks = foldContributionsIntoWeeks(contributions);
    if (weeks.length === 0) {
      return NO_GRID;
    }

    return {
      svgDataUri: svgToDataUri(buildContributionGridSvg(weeks, { emptied })),
      total: contributions.reduce((sum, cell) => sum + cell.count, 0),
    };
  } catch {
    return NO_GRID;
  }
}

export type OgImageRender = {
  response: Response;
  /** False when the grid fetch failed and the card fell back to a grid-less
   * layout — the caller caches those briefly so a transient jogruber outage
   * does not pin a degraded card for a full day. */
  gridIncluded: boolean;
};

/** Renders the 1200x630 OGP PNG for `user`'s share card. `score` may be null — see `OgImageHtmlInput`. */
export async function renderOgImage(user: string, score: number | null, percentage: number): Promise<OgImageRender> {
  // 100% は「1 個も残さず壊した」= clear と同値(刈り取り率は floor なので、
  // 1 ブロックでも残れば 99% 以下になる)。グリッドも文もこの 1 つの事実から
  // 決まる — 更地だと書いた下に生きた草を並べない(DESIGN-VISUAL §8)。
  const cleared = percentage === 100;
  const [grid, fonts] = await Promise.all([fetchGrid(user, cleared), loadOgFonts()]);

  // 総数が取れなかった回は段位を当てずに黙る。
  const taunt = cleared && grid.total !== null ? clearMessageFor(grid.total) : null;

  const html = buildOgImageHtml({ user, score, percentage, gridSvgDataUri: grid.svgDataUri, taunt });
  return {
    response: new ImageResponse(html, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, fonts }),
    gridIncluded: grid.svgDataUri !== null,
  };
}
