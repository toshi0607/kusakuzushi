/**
 * The two remote tools, as plain functions over a `fetch`-shaped OGP client
 * so they can be unit tested without a Durable Object. `index.ts` only wires
 * them into the MCP server.
 *
 * Both tools answer with one text part carrying JSON. The page-side bridge
 * (`agents/experimental/webmcp`) flattens `content[]` to a single string, so
 * a structured result would not survive the trip anyway — and the budget is
 * measured on that final string.
 */

import { isValidGithubUsername } from "@kusakuzushi/core/github-username";
import { buildHarvestIntentText, buildHarvestIntentUrl, buildIntentText, buildIntentUrl, buildShareUrl } from "@kusakuzushi/core/share-link";
import { foldContributionsIntoWeeks } from "@kusakuzushi/ogp/contribution-grid";
import { parseJogruberContributions, type ContributionCell } from "@kusakuzushi/ogp/jogruber";

const SITE_URL = "https://kusakuzushi.toshi0607.com";
/** Chrome's published guidance for WebMCP tool output, applied to the serialised text of every result. */
export const TOOL_OUTPUT_CHAR_LIMIT = 1500;
/** Marks Service Binding requests so the OGP Worker can throttle agent traffic on its own budget. */
export const VIA_HEADERS = { "x-kusakuzushi-via": "mcp" } as const;
/** How long a Service Binding call may take before the tool gives up (the render can take a few seconds cold). */
export const OGP_TIMEOUT_MS = 20_000;

/** The subset of `Fetcher` the tools use; a Service Binding satisfies it, and so does a test double. */
export type OgpClient = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

const serializedSize = (value: unknown) => JSON.stringify(value).length;

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a successful value as the tool's text part, or replaces it with an
 * error when the serialised form would exceed the output budget. The budget
 * is expected never to trip in practice (each tool's shape is sized below
 * it); this is the last line, not the mechanism.
 */
export function guardedResult(value: Record<string, unknown>): ToolResult {
  if (serializedSize(value) > TOOL_OUTPUT_CHAR_LIMIT) {
    return errorResult("result exceeded the output budget");
  }
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

const INVALID_USER = errorResult("user must be a GitHub username: letters, digits, and hyphens, 1-39 characters");

function isSafeInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

async function fetchOgp(ogp: OgpClient, url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OGP_TIMEOUT_MS);
  try {
    return await ogp.fetch(url, { headers: VIA_HEADERS, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function upstreamError(status: number): ToolResult {
  if (status === 429) {
    return errorResult("rate limited; retry after 60 seconds");
  }
  return errorResult(`upstream unavailable (status ${status})`);
}

type CompactGrid = {
  user: string;
  /** ISO dates of the first and last day the calendar covers. */
  from: string;
  to: string;
  /** Sum of the daily counts — the number the game shows as "N contributions". */
  total: number;
  /**
   * One string per week, Sunday to Saturday, each character a cell's level
   * (0-4). Padding days before `from` / after `to` read as 0. The game only
   * needs levels (they are the bricks' hit points), and 53 seven-character
   * strings fit the output budget where 371 dated objects would not.
   */
  weeks: string[];
};

/** Folds the validated calendar into the compact shape. Exported for the tests that fix its size. */
export function compactGrid(user: string, contributions: ContributionCell[]): CompactGrid {
  const weeks = foldContributionsIntoWeeks(contributions).map((week) => week.map((cell) => String(cell.level)).join(""));
  return {
    user,
    from: contributions[0]?.date ?? "",
    to: contributions[contributions.length - 1]?.date ?? "",
    total: contributions.reduce((sum, cell) => sum + cell.count, 0),
    weeks,
  };
}

export async function getContributionGrid(ogp: OgpClient, input: { user?: unknown }): Promise<ToolResult> {
  if (!isValidGithubUsername(input.user)) {
    return INVALID_USER;
  }
  const user = input.user;

  const response = await fetchOgp(ogp, `${SITE_URL}/api/grid/${encodeURIComponent(user)}`);
  if (!response) {
    return errorResult("contribution data unavailable (upstream did not answer)");
  }
  if (response.status === 404) {
    return errorResult(`user not found: ${user}`);
  }
  if (!response.ok) {
    return upstreamError(response.status);
  }

  let contributions: ContributionCell[];
  try {
    contributions = parseJogruberContributions(await response.json());
  } catch {
    return errorResult("contribution data unavailable (malformed upstream payload)");
  }
  if (contributions.length === 0) {
    return errorResult(`no contributions in the last year for ${user}`);
  }

  return guardedResult(compactGrid(user, contributions));
}

/** The OGP Worker names the calendar's total on the card response so a scored post needs no second fetch. */
export const TOTAL_HEADER = "x-kusakuzushi-total";

function readTotalHeader(response: Response): number | null {
  const raw = response.headers.get(TOTAL_HEADER);
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  const total = Number.parseInt(raw, 10);
  return Number.isSafeInteger(total) ? total : null;
}

async function fetchTotal(ogp: OgpClient, user: string): Promise<number | null> {
  const grid = await fetchOgp(ogp, `${SITE_URL}/api/grid/${encodeURIComponent(user)}`);
  if (!grid || !grid.ok) {
    return null;
  }
  try {
    return parseJogruberContributions(await grid.json()).reduce((sum, cell) => sum + cell.count, 0);
  } catch {
    return null;
  }
}

export type ShareCard = {
  user: string;
  percentage: number;
  score: number | null;
  /** The OGP card PNG, as rendered (and now cached at the edge) by the OGP Worker. */
  imageUrl: string;
  /** The link to post: crawlers get the card, humans get the game. */
  shareUrl: string;
  /** Ready-made X post: text plus `shareUrl`. */
  intentUrl: string;
  postText: string;
  /** Size and type of the rendered image, so an agent can confirm it is a real card without fetching it. */
  imageBytes: number;
  imageContentType: string;
};

/**
 * Renders (or reuses) the share card and returns everything needed to post
 * it — never the image itself, which would not fit any tool budget. With a
 * `score` the post reads like the web app's; without one it reads like the
 * extension's (rate only), and the card omits its score line.
 */
export async function renderShareCard(
  ogp: OgpClient,
  input: { user?: unknown; percentage?: unknown; score?: unknown },
): Promise<ToolResult> {
  if (!isValidGithubUsername(input.user)) {
    return INVALID_USER;
  }
  const user = input.user;
  if (!isSafeInteger(input.percentage, 0, 100)) {
    return errorResult("percentage must be an integer from 0 to 100");
  }
  const percentage = input.percentage;
  const hasScore = input.score !== undefined && input.score !== null;
  if (hasScore && !isSafeInteger(input.score, 0, Number.MAX_SAFE_INTEGER)) {
    return errorResult("score must be a non-negative integer when given");
  }
  const score = hasScore ? (input.score as number) : null;

  const shareUrl = buildShareUrl(user, percentage, score ?? undefined);
  const imageUrl = shareUrl.replace(`/share/${encodeURIComponent(user)}?`, `/share/${encodeURIComponent(user)}/og.png?`);

  const image = await fetchOgp(ogp, imageUrl);
  if (!image) {
    return errorResult("card rendering unavailable (upstream did not answer)");
  }
  if (!image.ok) {
    return upstreamError(image.status);
  }
  const imageBytes = (await image.arrayBuffer()).byteLength;
  const imageContentType = image.headers.get("content-type") ?? "";

  let postText: string;
  let intentUrl: string;
  if (score === null) {
    postText = buildHarvestIntentText(user, percentage);
    intentUrl = buildHarvestIntentUrl(user, percentage);
  } else {
    // The scored post names the year's total. The card's response carries
    // it (the renderer summed the same calendar it drew); a card cached
    // before that header existed falls back to the grid route.
    const total = readTotalHeader(image) ?? (await fetchTotal(ogp, user));
    if (total === null) {
      return errorResult("card rendered, but the contribution total for the post text is unavailable; retry");
    }
    postText = buildIntentText(user, total, percentage, score);
    intentUrl = buildIntentUrl(user, total, percentage, score);
  }

  const card: ShareCard = { user, percentage, score, imageUrl, shareUrl, intentUrl, postText, imageBytes, imageContentType };
  return guardedResult(card);
}
