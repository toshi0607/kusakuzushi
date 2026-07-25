/**
 * The only file allowed to know GitHub's contribution-graph markup:
 * selectors, cell extraction, and geometry inference. Every other module
 * in this extension works with the plain types exported here, so a future
 * GitHub markup change only ever needs a fix in this one place.
 */

export const GRASS_TABLE_SELECTOR = "table.ContributionCalendar-grid";
export const GRASS_DAY_SELECTOR = "td.ContributionCalendar-day";
export const GRAPH_CONTAINER_SELECTOR = ".js-yearly-contributions";

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

/** One `<td>` of the grass grid, resolved to the data the rest of the extension needs. */
export type GrassCell = {
  date: string;
  level: ContributionLevel;
  el: HTMLElement;
};

/** The subset of `DOMRect` `measureGeometry` needs, in page coordinates (scroll-inclusive). */
export type CellRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GrassGeometry = {
  cellWidth: number;
  cellHeight: number;
  gap: number;
  /** Page-coordinate top-left of the first (row 0, col 0) cell. */
  originX: number;
  originY: number;
  cols: number;
};

/** Coordinates within this many px of each other are treated as the same column/row (sub-pixel layout jitter). */
const CLUSTER_TOLERANCE_PX = 0.5;

/** Row-stride deviations larger than this (px) from the column-derived gap are logged but not treated as fatal. */
const ROW_STRIDE_WARN_TOLERANCE_PX = 1;

export function findGrassTable(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(GRASS_TABLE_SELECTOR);
}

export function findGraphContainer(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(GRAPH_CONTAINER_SELECTOR);
}

function parseLevel(value: string | null): ContributionLevel | null {
  if (value === null) return null;
  const level = Number(value);
  if (!Number.isInteger(level) || level < 0 || level > 4) return null;
  return level as ContributionLevel;
}

/** Reads every `td` that carries both `data-date` and a valid 0-4 `data-level`, sorted date-ascending. */
export function readGrassCells(table: HTMLElement): GrassCell[] {
  const cells: GrassCell[] = [];

  for (const el of table.querySelectorAll<HTMLElement>(GRASS_DAY_SELECTOR)) {
    const date = el.getAttribute("data-date");
    const level = parseLevel(el.getAttribute("data-level"));
    if (!date || level === null) continue;
    cells.push({ date, level, el });
  }

  // GitHub's DOM order is weekday-major (row 0 across every week, then row
  // 1, ...); `toGrid` needs a date-ascending flat array to fold correctly.
  cells.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return cells;
}

/** Rejects colours that would paint nothing: unset, or fully transparent. */
function isPaintable(color: string | null | undefined): color is string {
  if (!color) return false;
  const alpha = /^rgba\(.*,\s*([\d.]+)\s*\)$/.exec(color)?.[1];
  return alpha === undefined || Number(alpha) > 0;
}

/**
 * Reads the colour GitHub *would* paint for `level` by momentarily
 * inserting a `td` that matches its selectors next to a real cell.
 *
 * The probe copies the reference cell's classes and only overrides
 * `data-level`, so whatever rule GitHub uses for that level applies. It is
 * taken out of flow and hidden so it can't disturb the geometry measured
 * elsewhere, and removed before this returns.
 */
function probeLevelColor(reference: HTMLElement, level: number, view: Window): string | null {
  const parent = reference.parentElement;
  if (!parent) return null;

  const probe = reference.ownerDocument.createElement("td");
  probe.className = reference.className;
  probe.setAttribute("data-level", String(level));
  probe.style.position = "absolute";
  // `visibility: hidden` rather than `display: none` — the latter is still
  // computed, but keeping the box avoids relying on that subtlety.
  probe.style.visibility = "hidden";
  parent.appendChild(probe);

  try {
    return view.getComputedStyle(probe).backgroundColor || null;
  } finally {
    probe.remove();
  }
}

/**
 * Samples one `td` per contribution level (0-4) and reads its computed
 * `background-color`.
 *
 * A level with no cell of its own is ordinary, not exceptional: a profile
 * with no idle days has no level-0 cell at all. Those levels are probed
 * (see `probeLevelColor`) instead of failing the whole read, because the
 * caller's fallback is a bundled theme picked from the *OS* colour scheme
 * — which painted destroyed cells near-black on a light GitHub for anyone
 * running a dark Mac.
 *
 * Returns `null` only when there is nothing to read or probe from, leaving
 * the caller its theme fallback.
 */
export function readLevelColors(cells: GrassCell[], view: Window): readonly string[] | null {
  const reference = cells[0];
  if (!reference) return null;

  const colors: string[] = [];

  for (let level = 0; level <= 4; level++) {
    const cell = cells.find((c) => c.level === level);
    const color = cell ? view.getComputedStyle(cell.el).backgroundColor : probeLevelColor(reference.el, level, view);
    if (!isPaintable(color)) return null;
    colors.push(color);
  }

  return colors;
}

/** Groups ascending values into clusters no more than `tolerance` apart; returns one representative per cluster, ascending. */
function clusterAscending(values: readonly number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [];

  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || value - last > tolerance) {
      clusters.push(value);
    }
  }

  return clusters;
}

/** Smallest gap between consecutive cluster values, or `null` when there's only one cluster (no stride to measure). */
function minAdjacentDiff(clusters: readonly number[]): number | null {
  if (clusters.length < 2) return null;
  let min = Infinity;
  for (let i = 1; i < clusters.length; i++) {
    min = Math.min(min, clusters[i] - clusters[i - 1]);
  }
  return min;
}

/** Most frequent value in `values`, tie-broken by first occurrence. */
function mode(values: readonly number[]): number {
  const counts = new Map<number, number>();
  let best = values[0];
  let bestCount = 0;

  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }

  return best;
}

/**
 * Infers cell size, gap, origin, and column count from a flat list of cell
 * rects (as `getBoundingClientRect` + scroll offset would produce, in page
 * coordinates). Pure — the caller supplies the rects, so this is fully
 * unit-testable without a DOM.
 */
export function measureGeometry(rects: readonly CellRect[]): GrassGeometry | null {
  if (rects.length === 0) return null;
  if (rects.some((rect) => !(rect.width > 0) || !(rect.height > 0))) return null;

  const cellWidth = mode(rects.map((rect) => rect.width));
  const cellHeight = mode(rects.map((rect) => rect.height));

  const lefts = clusterAscending(
    rects.map((rect) => rect.left),
    CLUSTER_TOLERANCE_PX,
  );
  const tops = clusterAscending(
    rects.map((rect) => rect.top),
    CLUSTER_TOLERANCE_PX,
  );

  const strideX = minAdjacentDiff(lefts);
  const strideY = minAdjacentDiff(tops);

  // Gap always derives from the column stride (a single-column grid has no
  // strideX to measure, so it falls back to 0 — see grass-dom.test.ts).
  const gap = strideX !== null ? strideX - cellWidth : 0;

  if (strideY !== null && Math.abs(strideY - cellHeight - gap) > ROW_STRIDE_WARN_TOLERANCE_PX) {
    // Not fatal: the brick field only needs the X-derived gap to line up
    // with the real `td`s. Surfaced so a genuine GitHub markup change gets
    // noticed instead of silently misaligning the overlay.
    console.warn(
      `kusakuzushi: grass row stride (${strideY}px) does not match the column-derived gap (${gap}px); using the column gap.`,
    );
  }

  return {
    cellWidth,
    cellHeight,
    gap,
    originX: lefts[0],
    originY: tops[0],
    cols: lefts.length,
  };
}
