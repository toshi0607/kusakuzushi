/**
 * Data model for the GitHub contribution grid that the game engine consumes.
 * This module has no DOM / fetch dependency — it only transforms plain data.
 */

/** A single day of a GitHub contribution calendar. */
export type Cell = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

/**
 * A full contribution calendar folded into GitHub's own grid layout:
 * columns are weeks (oldest to newest, max 53), rows are days of the
 * week starting on Sunday (index 0) through Saturday (index 6).
 */
export type ContributionGrid = {
  username: string;
  weeks: Cell[][];
  total: number;
};

/**
 * Placeholder used to pad the leading days of the first week and the
 * trailing days of the last week when the year does not start/end on a
 * Sunday/Saturday. It carries level 0 so the game engine never spawns a
 * brick for it.
 */
const PAD_CELL: Cell = { date: "", count: 0, level: 0 };

/**
 * Folds a date-ascending flat array of contribution cells into GitHub's
 * week-column / weekday-row grid.
 *
 * Assumes `contributions` is a contiguous run of consecutive calendar days
 * (as returned by the GitHub contribution APIs, which include every day of
 * the range with count 0 where there was no activity) — the day-of-week of
 * the first entry alone is enough to align every subsequent entry.
 */
export function toGrid(username: string, contributions: Cell[]): ContributionGrid {
  const total = contributions.reduce((sum, cell) => sum + cell.count, 0);

  if (contributions.length === 0) {
    return { username, weeks: [], total: 0 };
  }

  const firstDayOfWeek = new Date(`${contributions[0].date}T00:00:00Z`).getUTCDay();

  const weeks: Cell[][] = [];
  let currentWeek: Cell[] = new Array(firstDayOfWeek).fill(PAD_CELL);

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

  return { username, weeks, total };
}
