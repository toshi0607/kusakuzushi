/**
 * Folds a date-ascending flat array of contribution cells into GitHub's
 * week-column / weekday-row grid (columns = weeks oldest-to-newest, rows =
 * Sunday..Saturday). Mirrors `packages/core`'s `toGrid` folding rule, but
 * kept local to this Worker so the OGP image renderer has no dependency on
 * the game engine package.
 */

import type { ContributionCell } from "./jogruber";

/**
 * Placeholder used to pad the leading days of the first week and the
 * trailing days of the last week when the range does not start/end on a
 * Sunday/Saturday. Level 0 so it renders as an empty cell.
 */
const PAD_CELL: ContributionCell = { date: "", count: 0, level: 0 };

/**
 * Assumes `contributions` is a contiguous run of consecutive calendar days
 * (as returned by the jogruber API) — the day-of-week of the first entry
 * alone is enough to align every subsequent entry.
 */
export function foldContributionsIntoWeeks(contributions: ContributionCell[]): ContributionCell[][] {
  if (contributions.length === 0) {
    return [];
  }

  const firstDayOfWeek = new Date(`${contributions[0].date}T00:00:00Z`).getUTCDay();

  const weeks: ContributionCell[][] = [];
  let currentWeek: ContributionCell[] = new Array(firstDayOfWeek).fill(PAD_CELL);

  for (const cell of contributions) {
    currentWeek.push(cell);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(PAD_CELL);
    }
    weeks.push(currentWeek);
  }

  return weeks;
}
