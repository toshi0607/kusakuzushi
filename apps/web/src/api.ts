/**
 * Data-fetching adapter between the jogruber GitHub-contributions API and
 * core's plain `Cell[]` / `ContributionGrid` model. No rendering or game
 * logic lives here — only network access and payload validation.
 */

import type { Cell, ContributionGrid } from "@kusakuzushi/core";
import { toGrid } from "@kusakuzushi/core";

const JOGRUBER_API_BASE = "https://github-contributions-api.jogruber.de/v4";
// Keep these date, 53-week, consecutive, and padded-width checks aligned with
// workers/ogp/src/jogruber.ts; separate bundles retain their own error behavior.
/** The core contribution-grid model renders at most 53 weeks of 7 days. */
const MAX_CONTRIBUTION_DAYS = 53 * 7;
// Keep this 64 KiB streaming limit aligned with workers/ogp/src/og-image.ts.
// A 371-cell response is normally below 32 KiB; 64 KiB leaves room for API
// metadata while keeping an untrusted upstream body inexpensive to parse.
const MAX_RESPONSE_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Thrown by `fetchGrid` when the API reports the username does not exist (HTTP 404). */
export class UserNotFoundError extends Error {
  readonly username: string;

  constructor(username: string) {
    super(`user not found: ${username}`);
    this.name = "UserNotFoundError";
    this.username = username;
  }
}

/** Thrown by `fetchGrid` for any other network or non-2xx failure. */
export class ContributionFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionFetchError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCell(value: unknown): Cell {
  if (!isRecord(value)) {
    throw new Error("不正な contribution データです(オブジェクトではありません)");
  }

  const { date, count, level } = value;

  if (typeof date !== "string" || date.length === 0) {
    throw new Error("不正な contribution データです(date)");
  }
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error("不正な contribution データです(count)");
  }
  // Levels outside 0-4 are rejected rather than clamped — malformed input
  // must never silently reach the game engine's brick layout.
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4) {
    throw new Error("不正な contribution データです(level)");
  }

  return { date, count, level: level as 0 | 1 | 2 | 3 | 4 };
}

function parseDate(date: string): number {
  if (!ISO_DATE.test(date)) {
    throw new Error("不正な contribution データです(date)");
  }

  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error("不正な contribution データです(date)");
  }

  return timestamp;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    throw new ContributionFetchError("APIレスポンスが大きすぎます");
  }

  if (!response.body) {
    throw new ContributionFetchError("APIレスポンスの本文がありません");
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
        throw new ContributionFetchError("APIレスポンスが大きすぎます");
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

/**
 * Validates and converts a jogruber `/v4/{user}` JSON payload
 * (`{ total: { lastYear }, contributions: [...] }`) into core's flat
 * `Cell[]`. Throws on any structural mismatch.
 */
export function parseContributions(json: unknown): Cell[] {
  if (!isRecord(json)) {
    throw new Error("不正なレスポンスです(オブジェクトではありません)");
  }

  const total = json.total;
  if (!isRecord(total) || typeof total.lastYear !== "number") {
    throw new Error("不正なレスポンスです(total.lastYear)");
  }

  const contributions = json.contributions;
  if (!Array.isArray(contributions)) {
    throw new Error("不正なレスポンスです(contributions)");
  }
  if (contributions.length > MAX_CONTRIBUTION_DAYS) {
    throw new Error("不正なレスポンスです(contributions)");
  }
  if (contributions.length > 0) {
    const firstDate = parseDate(parseCell(contributions[0]).date);
    if (new Date(firstDate).getUTCDay() + contributions.length > MAX_CONTRIBUTION_DAYS) {
      throw new Error("不正なレスポンスです(contributions)");
    }
  }

  let previousDate: number | undefined;
  return contributions.map((value) => {
    const cell = parseCell(value);
    const date = parseDate(cell.date);
    if (previousDate !== undefined && date !== previousDate + DAY_MS) {
      throw new Error("不正な contribution データです(date)");
    }
    previousDate = date;
    return cell;
  });
}

/** True if `grid` has at least one destroyable brick (a level >= 1 cell). */
export function hasBricks(grid: ContributionGrid): boolean {
  return grid.weeks.some((week) => week.some((cell) => cell.level >= 1));
}

/**
 * Fetches `username`'s last-year contribution calendar from the jogruber
 * API and converts it into a core `ContributionGrid`.
 */
export async function fetchGrid(username: string): Promise<ContributionGrid> {
  let response: Response;
  try {
    response = await fetch(`${JOGRUBER_API_BASE}/${encodeURIComponent(username)}?y=last`);
  } catch (error) {
    throw new ContributionFetchError(
      `ネットワークエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 404) {
    throw new UserNotFoundError(username);
  }
  if (!response.ok) {
    throw new ContributionFetchError(`APIエラーが発生しました(status: ${response.status})`);
  }

  const json = await parseJsonResponse(response);
  const cells = parseContributions(json);
  return toGrid(username, cells);
}
