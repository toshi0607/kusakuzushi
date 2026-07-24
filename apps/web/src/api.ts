/**
 * Data-fetching adapter between the jogruber GitHub-contributions API and
 * core's plain `Cell[]` / `ContributionGrid` model. No rendering or game
 * logic lives here — only network access and payload validation.
 */

import type { Cell, ContributionGrid } from "@kusakuzushi/core";
import { toGrid } from "@kusakuzushi/core";

const JOGRUBER_API_BASE = "https://github-contributions-api.jogruber.de/v4";

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

  return contributions.map(parseCell);
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

  const json: unknown = await response.json();
  const cells = parseContributions(json);
  return toGrid(username, cells);
}
