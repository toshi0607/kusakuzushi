/**
 * Validates a jogruber `/v4/{user}` JSON payload's `contributions` array
 * into typed cells. Only `contributions` is used here — the score shown on
 * the card comes from the `s` query param, not a recomputed total, so
 * `total.lastYear` is intentionally not validated.
 */

export type ContributionCell = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

/** The contribution-grid renderer supports at most 53 weeks of 7 days. */
const MAX_CONTRIBUTION_DAYS = 53 * 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCell(value: unknown): ContributionCell {
  if (!isRecord(value)) {
    throw new Error("invalid contribution cell: not an object");
  }

  const { date, count, level } = value;

  if (typeof date !== "string" || date.length === 0) {
    throw new Error("invalid contribution cell: date");
  }
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new Error("invalid contribution cell: count");
  }
  // Levels outside 0-4 are rejected rather than clamped — malformed input
  // must never silently reach the SVG renderer's color lookup table.
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4) {
    throw new Error("invalid contribution cell: level");
  }

  return { date, count, level: level as 0 | 1 | 2 | 3 | 4 };
}

function parseDate(date: string): number {
  if (!ISO_DATE.test(date)) {
    throw new Error("invalid contribution cell: date");
  }

  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new Error("invalid contribution cell: date");
  }

  return timestamp;
}

/** Converts a jogruber `/v4/{user}` JSON payload into `ContributionCell[]`. Throws on any structural mismatch. */
export function parseJogruberContributions(json: unknown): ContributionCell[] {
  if (!isRecord(json)) {
    throw new Error("invalid jogruber response: not an object");
  }

  const { contributions } = json;
  if (!Array.isArray(contributions)) {
    throw new Error("invalid jogruber response: contributions");
  }
  if (contributions.length > MAX_CONTRIBUTION_DAYS) {
    throw new Error("invalid jogruber response: contributions");
  }
  if (contributions.length > 0) {
    const firstDate = parseDate(parseCell(contributions[0]).date);
    if (new Date(firstDate).getUTCDay() + contributions.length > MAX_CONTRIBUTION_DAYS) {
      throw new Error("invalid jogruber response: contributions");
    }
  }

  let previousDate: number | undefined;
  return contributions.map((value) => {
    const cell = parseCell(value);
    const date = parseDate(cell.date);
    if (previousDate !== undefined && date !== previousDate + DAY_MS) {
      throw new Error("invalid contribution cell: date");
    }
    previousDate = date;
    return cell;
  });
}
